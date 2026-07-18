import { EventConfig, EventExecute } from "@/types";

export const config: EventConfig = {
  name: "autokick",
  description:
    "Automatically kicks a group member who spams 20 messages within a short time window.",
  creator: "AjiroDesu",
  // Passive watcher, same shape as autodl — it looks at every ordinary
  // message and tracks send frequency itself rather than binding to a
  // dedicated Telegram event name.
  trigger: "message",
  // Unlike autodl, spam counts regardless of whether the message is a
  // command — someone hammering "/help" 20 times in a row is still
  // spamming — so this intentionally does NOT set skipCommandPrefix.
};

// How many messages within the window count as spam.
const SPAM_LIMIT = 60;
// The window messages are counted over, in milliseconds.
const SPAM_WINDOW_MS = 15_000;

// chatId:userId -> timestamps (ms) of recent messages, oldest first.
const messageLog = new Map<string, number[]>();

export async function execute({ api, event }: EventExecute) {
  try {
    // Group-only: DMs and channels don't have members to kick.
    if (event.chat.type !== "group" && event.chat.type !== "supergroup") {
      return;
    }

    const user = event.from;
    if (!user) return;

    const me = await api.getMe();
    if (user.id === me.id) return;

    const key = `${event.chat.id}:${user.id}`;
    const now = Date.now();

    // Keep only timestamps still inside the window, then record this one.
    const timestamps = (messageLog.get(key) ?? []).filter(
      (t) => now - t < SPAM_WINDOW_MS,
    );
    timestamps.push(now);
    messageLog.set(key, timestamps);

    if (timestamps.length < SPAM_LIMIT) return;

    // Threshold hit — reset immediately so a failed kick attempt below
    // doesn't re-trigger on every subsequent message.
    messageLog.delete(key);

    // Never try to kick a group admin/creator, even if they're spamming —
    // same courtesy as the manual /kick command.
    const member = await api.getChatMember(event.chat.id, user.id);
    if (member.status === "creator" || member.status === "administrator") {
      return;
    }

    const displayName = user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.first_name;

    // "Kick" = ban immediately followed by unban, so the member is
    // removed but can rejoin later rather than being permanently banned.
    await api.banChatMember(event.chat.id, user.id);
    await api.unbanChatMember(event.chat.id, user.id, {
      only_if_banned: true,
    });

    await api.sendMessage(
      event.chat.id,
      `🚨 *${displayName}* was auto-kicked for spamming (${SPAM_LIMIT}+ messages in ${SPAM_WINDOW_MS / 1000}s).`,
    );
  } catch (error: any) {
    // Most common real-world failure: the bot isn't a group admin (or
    // lacks the "restrict members" right) — stay quiet rather than spam
    // the chat with an error on every message this happens on.
    if (error?.response?.body?.description?.includes("not enough rights")) {
      return;
    }
    console.error("autokick event error:", error);
  }
}
