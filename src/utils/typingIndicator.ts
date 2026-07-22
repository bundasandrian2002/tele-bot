import TelegramBot from "node-telegram-bot-api";

// Telegram's "typing…" indicator only lasts ~5s before the client hides
// it again, so anything that takes longer than that needs the chat
// action re-sent on an interval to keep it visibly "on" for the whole
// duration of the work — not a single fire-and-forget call.
const TYPING_REFRESH_MS = 1_000;

/**
 * Starts a "typing…" indicator for the given chat that keeps refreshing
 * itself until stopped, so it stays visible for however long the caller's
 * processing actually takes rather than a hardcoded duration. Returns a
 * function that stops the indicator — always call it once processing is
 * done (success or failure), ideally from a `finally` block.
 */
export function startTypingIndicator(
  bot: TelegramBot,
  chatId: number,
): () => void {
  let stopped = false;

  const ping = () => {
    if (stopped) return;
    bot.sendChatAction(chatId, "typing").catch(() => {
      // Best-effort — a failed chat action shouldn't interrupt whatever
      // is being processed.
    });
  };

  ping();
  const interval = setInterval(ping, TYPING_REFRESH_MS);
  // Don't let this timer keep the process alive if something upstream hangs.
  interval.unref?.();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
