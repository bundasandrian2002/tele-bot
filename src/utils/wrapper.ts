/**
 * Telegram Message Wrapper
 *
 * Ported from Persian-Bot/Cat-Bot's platform wrapper
 * (packages/cat-bot/src/engine/adapters/platform/telegram/wrapper.ts), which
 * wraps grammY's `Context` behind a `UnifiedApi` class so every outgoing
 * message is routed through one place that applies MarkdownV2 sanitisation
 * before anything reaches the Bot API.
 *
 * This project talks to Telegram directly through `node-telegram-bot-api`
 * instead of grammY, and every command/event already calls `api.sendMessage`,
 * `api.sendPhoto`, etc. straight on the `TelegramBot` instance — there is no
 * `UnifiedApi` class shell to slot into. The equivalent here is a
 * `Proxy` around the real `TelegramBot` instance: every text-bearing method
 * (`sendMessage`, `sendPhoto`, `sendVideo`, `sendAudio`, `sendVoice`,
 * `sendAnimation`, `sendDocument`, `sendMediaGroup`, `editMessageText`,
 * `editMessageCaption`) is intercepted so its text/caption is run through
 * `sanitizeMarkdownV2` and defaulted to `parse_mode: 'MarkdownV2'` — while
 * every other method (banChatMember, restrictChatMember, getChatMember,
 * getMe, etc.) passes straight through untouched. Command and event files
 * don't need to know this wrapping exists; they keep calling `api.sendMessage(...)`
 * exactly as before and get MarkdownV2-safe output "for free".
 *
 * Architecture:
 *   markdown.util.ts — the escaping/sanitising engine (ported from Cat-Bot)
 *   wrapper.ts        — this file: wires that engine into every outgoing
 *                        Telegram call via a transparent Proxy
 *
 * Callers can still opt out per-call by passing an explicit `parse_mode`
 * (including `parse_mode: undefined` won't override — pass a real mode, e.g.
 * `'HTML'`, if a specific message truly needs something other than
 * MarkdownV2) since caller-supplied options always win over the wrapper's
 * default.
 */
import TelegramBot from "node-telegram-bot-api";
import { sanitizeMarkdownV2 } from "@/utils/markdown.util";

type AnyRecord = Record<string, unknown>;

/** Runs sanitizeMarkdownV2 on a string field, leaving non-strings untouched. */
function sanitize(text: unknown): unknown {
  return typeof text === "string" && text.length > 0
    ? sanitizeMarkdownV2(text)
    : text;
}

/** Merges the MarkdownV2 default into an options object without clobbering an explicit caller override. */
function withMarkdownDefault(options: unknown): AnyRecord {
  const opts: AnyRecord = { ...(options as AnyRecord | undefined) };
  if (opts.parse_mode === undefined) {
    opts.parse_mode = "MarkdownV2";
  }
  return opts;
}

// Methods shaped as (chatId, text, options?) — the text to sanitize is the
// 2nd positional argument, options (carrying parse_mode) is the 3rd.
const TEXT_METHODS = new Set(["sendMessage"]);

// Methods shaped as (chatId, source, options?, fileOptions?) — the text to
// sanitize lives at options.caption, not a positional argument.
const CAPTION_METHODS = new Set([
  "sendPhoto",
  "sendVideo",
  "sendAudio",
  "sendVoice",
  "sendAnimation",
  "sendDocument",
]);

// Methods shaped as (text, options?) where options carries chat_id/message_id.
const EDIT_TEXT_METHODS = new Set(["editMessageText"]);

// Methods shaped as (caption, options?) where options carries chat_id/message_id.
const EDIT_CAPTION_METHODS = new Set(["editMessageCaption"]);

/** Sanitizes the `caption` field (if present) on a single sendMediaGroup item. */
function sanitizeMediaItem(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const media = item as AnyRecord;
  if (typeof media.caption !== "string" || media.caption.length === 0) {
    return media;
  }
  const out: AnyRecord = { ...media, caption: sanitize(media.caption) };
  if (out.parse_mode === undefined) out.parse_mode = "MarkdownV2";
  return out;
}

/**
 * Wraps a `TelegramBot` instance so every outgoing text/caption is sanitized
 * for MarkdownV2 and defaults to `parse_mode: 'MarkdownV2'`. Everything that
 * isn't a text-bearing send/edit method (banChatMember, getChatMember,
 * getMe, restrictChatMember, leaveChat, getMyName, on/off listeners, etc.)
 * is forwarded untouched, so this is a drop-in replacement for the raw bot
 * instance everywhere it's currently used.
 */
export function wrapBot(bot: TelegramBot): TelegramBot {
  const handler: ProxyHandler<TelegramBot> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") {
        return value;
      }
      const bound = value.bind(target);

      if (TEXT_METHODS.has(prop)) {
        return (chatId: unknown, text: unknown, options?: unknown, ...rest: unknown[]) =>
          bound(chatId, sanitize(text), withMarkdownDefault(options), ...rest);
      }

      if (CAPTION_METHODS.has(prop)) {
        return (chatId: unknown, source: unknown, options?: unknown, ...rest: unknown[]) => {
          const opts = withMarkdownDefault(options);
          if (typeof opts.caption === "string" && opts.caption.length > 0) {
            opts.caption = sanitize(opts.caption);
          }
          return bound(chatId, source, opts, ...rest);
        };
      }

      if (EDIT_TEXT_METHODS.has(prop)) {
        return (text: unknown, options?: unknown, ...rest: unknown[]) =>
          bound(sanitize(text), withMarkdownDefault(options), ...rest);
      }

      if (EDIT_CAPTION_METHODS.has(prop)) {
        return (caption: unknown, options?: unknown, ...rest: unknown[]) =>
          bound(sanitize(caption), withMarkdownDefault(options), ...rest);
      }

      if (prop === "sendMediaGroup") {
        return (chatId: unknown, media: unknown, options?: unknown, ...rest: unknown[]) => {
          const sanitizedMedia = Array.isArray(media)
            ? media.map(sanitizeMediaItem)
            : media;
          return bound(chatId, sanitizedMedia, options, ...rest);
        };
      }

      return bound;
    },
  };

  return new Proxy(bot, handler);
}
