/**
 * AutoGreet — proactively broadcasts a greeting to every active group at
 * four fixed times a day: morning, afternoon, evening, and midnight.
 *
 * This lives under src/lib rather than src/events because it isn't
 * triggered by an incoming Telegram update the way every other event file
 * is (handleEvents.ts only wires up bot.on(trigger) listeners) — it's a
 * self-driven polling loop, started once from index.ts via
 * startAutoGreetScheduler(), same idea as keep_alive.ts's express server
 * being started as a side effect at boot.
 */
import TelegramBot from "node-telegram-bot-api";
import { getActiveGroups, getBotSetting, setBotSetting } from "@/lib/db";

type BroadcastSlot = {
  period: string;
  hour: number;
  minute: number;
  emoji: string;
  label: string;
};

// Bot audience is Manila-based, so every slot below fires at that wall-clock
// hour in Asia/Manila — regardless of what timezone the server's OS clock
// happens to be set to (local dev machine, UTC container host, etc).
const GREETING_TIME_ZONE = "Asia/Manila";

const BROADCAST_SCHEDULE: BroadcastSlot[] = [
  { period: "morning", hour: 6, minute: 0, emoji: "🌅", label: "Good morning" },
  { period: "afternoon", hour: 12, minute: 0, emoji: "☀️", label: "Good afternoon" },
  { period: "evening", hour: 18, minute: 0, emoji: "🌇", label: "Good evening" },
  // Midnight is hour 0, not 24 — Intl (like Date#getHours) reports the
  // 0-23 hour, so a literal 24 here would never match and this slot would
  // silently never fire.
  { period: "midnight", hour: 0, minute: 0, emoji: "🌙", label: "It's midnight" },
];

// How often we check the clock against BROADCAST_SCHEDULE. Well under 60s
// so a slot's target minute is never skipped between checks.
const POLL_INTERVAL_MS = 30_000;

// Persisted (not in-memory) per-period "last sent" date, via the same
// bot_settings table src/lib/db.ts already uses for prefix/developer_mode.
// This has to survive restarts: an in-memory flag would re-broadcast right
// after every deploy/restart that happens to land inside a target minute.
function lastSentSettingKey(period: string): string {
  return `autogreet_last_sent_${period}`;
}

// Single Intl formatter reused across calls, pulling year/month/day/hour/
// minute for Asia/Manila in one pass. Reading all five fields from one
// formatToParts() call (rather than separate hour/minute/date lookups)
// avoids the edge case where the wall clock ticks over between two
// separate `new Date()` reads right at a slot boundary or midnight.
const manilaFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: GREETING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

type ManilaNow = { dateString: string; hour: number; minute: number };

function getManilaNow(date: Date = new Date()): ManilaNow {
  const parts = manilaFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  let hour = Number.parseInt(get("hour"), 10);
  // Some ICU implementations format midnight as "24" with hour12: false —
  // normalize so the boundary checks below never see an out-of-range value.
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(get("minute"), 10);

  const dateString = `${get("year")}-${get("month")}-${get("day")}`;

  return { dateString, hour, minute };
}

async function broadcastGreeting(bot: TelegramBot, slot: BroadcastSlot) {
  const groups = await getActiveGroups();
  if (!groups.length) return;

  const text = `${slot.emoji} *${slot.label}, everyone!*`;

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
  const { dateString: today, hour, minute } = getManilaNow();

  for (const slot of BROADCAST_SCHEDULE) {
    if (hour !== slot.hour || minute !== slot.minute) continue;

    const key = lastSentSettingKey(slot.period);
    try {
      const lastSent = await getBotSetting(key);
      if (lastSent === today) continue;

      await broadcastGreeting(bot, slot);
      await setBotSetting(key, today);
    } catch (error) {
      console.error(`autogreet scheduler error for '${slot.period}':`, error);
    }
  }
}

/**
 * Starts the morning/afternoon/evening/midnight broadcast. Call once from
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
