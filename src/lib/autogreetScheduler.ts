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

type BroadcastPeriod = "morning" | "afternoon" | "evening" | "midnight";

type BroadcastSlot = {
  period: BroadcastPeriod;
  hour: number;
  minute: number;
  emoji: string;
  label: string;
};

// Server-local time — this bot has no per-group timezone setting, so
// "morning" means morning wherever the process happens to be running.
const BROADCAST_SCHEDULE: BroadcastSlot[] = [
  { period: "morning", hour: 6, minute: 0, emoji: "🌅", label: "Good morning" },
  { period: "afternoon", hour: 12, minute: 0, emoji: "☀️", label: "Good afternoon" },
  { period: "evening", hour: 18, minute: 0, emoji: "🌇", label: "Good evening" },
  { period: "midnight", hour: 0, minute: 0, emoji: "🌙", label: "It's midnight" },
];

// How often we check the clock against BROADCAST_SCHEDULE. Well under 60s
// so a slot's target minute is never skipped between checks.
const POLL_INTERVAL_MS = 30_000;

// Persisted (not in-memory) per-period "last sent" date, via the same
// bot_settings table src/lib/db.ts already uses for prefix/developer_mode.
// This has to survive restarts: an in-memory flag would re-broadcast right
// after every deploy/restart that happens to land inside a target minute.
function lastSentSettingKey(period: BroadcastPeriod): string {
  return `autogreet_last_sent_${period}`;
}

// YYYY-MM-DD in server-local time (matches the local getHours()/getMinutes()
// checks below), so a slot fires at most once per calendar day.
function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  const now = new Date();
  const today = localDateString(now);

  for (const slot of BROADCAST_SCHEDULE) {
    if (now.getHours() !== slot.hour || now.getMinutes() !== slot.minute) continue;

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
