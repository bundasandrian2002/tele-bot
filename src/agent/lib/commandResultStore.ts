import TelegramBot from "node-telegram-bot-api";

// Single-use, in-memory handoff between the test_command and send_result
// agent tools — mirrors Cat-Bot's command-result-store.lib.ts. test_command
// intercepts the Telegram API calls a batch of commands would have made and
// stores them all under one key; send_result later looks that key up to
// replay (forward) them into the real chat.

export type InterceptedCall = {
  method: string;
  // Which command in a test_command batch produced this call — mirrors
  // Cat-Bot's sourceCommand tagging, so a multi-command batch's captured
  // output stays attributable when the LLM reads the summary.
  sourceCommand?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];
};

// Methods that attach a real photo/video/document/etc. — as opposed to
// sendMessage (plain text) or setMessageReaction. Shared with test_command's
// own MEDIA_METHODS check so "is this actually a media attachment" is
// defined in exactly one place.
export const MEDIA_METHODS = new Set([
  "sendPhoto",
  "sendVideo",
  "sendDocument",
  "sendAudio",
  "sendAnimation",
  "sendVoice",
]);

// Telegram's hard limit on caption length. A reply longer than this can't
// ride along as a media caption and has to fall back to a separate text
// message instead.
export const TELEGRAM_CAPTION_LIMIT = 1024;

const store = new Map<string, InterceptedCall[]>();

// A key only ever needs to survive from one test_command call to the
// send_result call that follows it in the same agent turn — this bound
// just guards against a key leaking forever if send_result is never
// called (e.g. the agent hits its turn limit first).
const ENTRY_TTL_MS = 10 * 60 * 1000;

export function generateKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function setCalls(key: string, calls: InterceptedCall[]): void {
  store.set(key, calls);
  const timer = setTimeout(() => store.delete(key), ENTRY_TTL_MS);
  // Don't let this timer keep the process alive on shutdown.
  timer.unref();
}

// Single-use: reading a key also deletes it, so a stale/replayed key
// can't be forwarded twice.
export function takeCalls(key: string): InterceptedCall[] | undefined {
  const calls = store.get(key);
  store.delete(key);
  return calls;
}

export type ForwardResult = {
  forwarded: number;
  // True once `caption` (if any was passed in) actually got attached to a
  // real media call, so the caller knows it doesn't also need to send a
  // separate plain-text message for the same reply.
  captionAttached: boolean;
};

/**
 * Replays a set of captured calls verbatim against the real bot API,
 * retargeting them at `chatId` (a command may have originally run against
 * a different chat's event). Shared by send_result and by agent.ts's
 * guaranteed-delivery fallback, so both forward media the exact same way.
 *
 * When `caption` is provided, it's attached to the *first* media call in
 * `calls` (overriding whatever caption that command originally set) so the
 * AI's reply arrives as part of the actual attachment — the way a person
 * sending a photo with a message would do it — instead of as a disconnected
 * text bubble sent before or after the media.
 *
 * `api` here is always the wrapped bot from utils/wrapper.ts (never the raw
 * TelegramBot instance) — the intercepted calls captured by test_command's
 * mockApi carry raw, unsanitized text/captions, so replaying them through
 * the wrapped api's sendMessage/sendPhoto/etc. is what applies MarkdownV2
 * sanitization before anything actually reaches the chat.
 */
export async function forwardCalls(
  api: TelegramBot,
  chatId: number,
  calls: InterceptedCall[],
  caption?: string,
): Promise<ForwardResult> {
  let forwarded = 0;
  let captionAttached = false;
  const canAttachCaption = !!caption && caption.length <= TELEGRAM_CAPTION_LIMIT;

  for (const call of calls) {
    // Reactions were only captured to keep test_command silent — replaying
    // them here would react to the wrong message (whatever triggered the
    // /ai or nickname invocation, not the original command's target).
    if (call.method === "setMessageReaction") continue;

    try {
      const replayArgs = [...call.args];
      replayArgs[0] = chatId;

      if (!captionAttached && canAttachCaption && MEDIA_METHODS.has(call.method)) {
        const opts = { ...((replayArgs[2] as Record<string, unknown>) ?? {}) };
        opts.caption = caption;
        replayArgs[2] = opts;
        captionAttached = true;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (api as any)[call.method](...replayArgs);
      forwarded++;
    } catch (err) {
      console.error(`forwardCalls: failed to forward ${call.method}`, err);
    }
  }

  return { forwarded, captionAttached };
}
