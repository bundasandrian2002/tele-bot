/**
 * AutoGreet — proactively broadcasts a greeting to every active group the
 * moment the current time in Manila crosses into a new period: Morning,
 * Afternoon, Evening, or Night.
 *
 * This lives under src/lib rather than src/events because it isn't
 * triggered by an incoming Telegram update the way every other event file
 * is (handleEvents.ts only wires up bot.on(trigger) listeners) — it's a
 * self-driven polling loop, started once from index.ts via
 * startAutoGreetScheduler().
 *
 * NOT currently wired up by src/bot/manager.ts. getActiveGroups() reads
 * every row in the `groups` table with no bot_instance_id filter — under
 * the multi-user dashboard, that table is shared by every tenant's bot,
 * so calling this per-instance would broadcast one user's bot into every
 * other tenant's Telegram groups. Re-enable only after scoping `groups`
 * (and really `users`/`user_wallets`/`user_levels` too — none of them
 * carry a bot_instance_id yet) to the owning instance.
 */
import TelegramBot from "node-telegram-bot-api";
import { getActiveGroups, getBotSetting, setBotSetting } from "@/lib/db";

type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

// Bot audience is Manila-based, so the active period must always be read
// from Asia/Manila — never the server's own OS timezone (local dev
// machine, UTC container host, etc). This is the single source of truth
// both for deciding *what* greeting to send and *when* to send it.
const GREETING_TIME_ZONE = "Asia/Manila";

const GREETING_TEXT: Record<GreetingPeriod, { emoji: string; label: string }> = {
  morning: { emoji: "🌅", label: "Good morning" },
  afternoon: { emoji: "☀️", label: "Good afternoon" },
  evening: { emoji: "🌇", label: "Good evening" },
  night: { emoji: "🌙", label: "Good night" },
};

// Single Intl formatter reused across calls, pulling the Asia/Manila hour.
// Uses Intl's timeZone-aware formatter rather than a manual UTC+8 offset,
// so this stays correct even if the host's own TZ/env is misconfigured —
// no DST in the Philippines, but this also avoids off-by-one drift from
// hand-rolled offset math.
const manilaHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: GREETING_TIME_ZONE,
  hour: "numeric",
  hour12: false,
});

function getManilaHour(date: Date = new Date()): number {
  const formatted = manilaHourFormatter.format(date);
  const hour = Number.parseInt(formatted, 10);
  // Some ICU implementations format midnight as "24" with hour12: false —
  // normalize so the boundary checks below never see an out-of-range value.
  return hour === 24 ? 0 : hour;
}

// Strict, exhaustive, non-overlapping mapping: every hour 0-23 falls into
// exactly one of the four branches below, so every possible Manila hour
// maps to one — and only one — period, and it's recomputed fresh on every
// poll tick (never cached), so the result always reflects the *current*
// instant rather than a stale value from an earlier check.
//   Morning:   05:00–11:59
//   Afternoon: 12:00–17:59
//   Evening:   18:00–21:59
//   Night:     22:00–04:59
function currentPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

// How often we check the clock against the current Manila period. Well
// under the shortest period's length (Evening, 4 hours), so a boundary
// crossing is always caught within 30 seconds — effectively immediate.
const POLL_INTERVAL_MS = 30_000;

// Persisted (not in-memory) "last broadcast period" marker, via the same
// bot_settings table src/lib/db.ts already uses for prefix/developer_mode.
// This has to survive restarts: an in-memory flag would re-broadcast right
// after every deploy/restart that happens to land inside an already-
// greeted period.
//
// Deliberately just the period name — no date. The four periods always
// cycle in the same order (morning → afternoon → evening → night →
// morning...), so comparing "is the current period different from the
// last one we broadcast" is sufficient on its own to catch every genuine
// transition, including Night → Morning the next calendar day. Keying by
// date as well would be wrong: Night spans two calendar dates (22:00 to
// 04:59), so a date-based key would see the date change at midnight and
// fire a second, spurious "Good night" broadcast mid-period.
const LAST_BROADCAST_PERIOD_KEY = "autogreet_last_broadcast_period";

async function broadcastGreeting(bot: TelegramBot, period: GreetingPeriod) {
  const groups = await getActiveGroups();
  if (!groups.length) return;

  const { emoji, label } = GREETING_TEXT[period];
  const text = `${emoji} *${label}, everyone!*`;

  for (const group of groups) {
    try {
      await bot.sendMessage(group.id, text);
    } catch (error) {
      // One group failing (bot kicked, chat deleted, etc.) shouldn't stop
      // the broadcast from reaching every other active group.
      console.error(`autogreet broadcast failed for group ${group.id}:`, error);
    }
  }
}

async function checkSchedule(bot: TelegramBot) {
  const period = currentPeriod(getManilaHour());

  try {
    const lastBroadcastPeriod = await getBotSetting(LAST_BROADCAST_PERIOD_KEY);
    // Still within the period we already greeted for — nothing to do
    // until the clock actually crosses into the next one.
    if (lastBroadcastPeriod === period) return;

    await broadcastGreeting(bot, period);
    await setBotSetting(LAST_BROADCAST_PERIOD_KEY, period);
  } catch (error) {
    console.error(`autogreet scheduler error for period '${period}':`, error);
  }
}

/**
 * Starts the Morning/Afternoon/Evening/Night broadcast. Call once from
 * index.ts's setupChatbot(), after handleEvents() has wired up the
 * wrappedBot instance, so broadcast messages get the same MarkdownV2
 * sanitization as every other outgoing message.
 */
export function startAutoGreetScheduler(bot: TelegramBot) {
  checkSchedule(bot).catch((error) =>
    console.error("autogreet scheduler initial check failed:", error),
  );
  setInterval(() => {
    checkSchedule(bot).catch((error) =>
      console.error("autogreet scheduler tick failed:", error),
    );
  }, POLL_INTERVAL_MS);
}
