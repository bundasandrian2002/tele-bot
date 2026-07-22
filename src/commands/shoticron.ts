import { Config, Execute } from "@/types";
import "dotenv/config";
import TelegramBot, { Message } from "node-telegram-bot-api";
import Shoti from "showty";

export const config: Config = {
  name: "shoticron",
  description:
    "Automatically generate a random video from TikTok on a recurring interval.",
  usage: "/shoticron <on|off|status|setinterval|interval|reset>",
  permission: "admin",
  creator: "libyzxy0",
};

// Same pattern as shoti.ts/ishoti.ts/add.ts — surface a clear cause in the
// logs at startup rather than a confusing auth failure the first time
// /shoticron runs.
if (!process.env.SHOTI_APIKEY) {
  console.error(
    "[shoticron] SHOTI_APIKEY is not set — the /shoticron command will fail until it's added to your environment variables.",
  );
}

// Constructing the client at module scope used to mean: if the "showty"
// constructor validates its argument and throws for a missing/invalid
// SHOTI_APIKEY, that throw happens the instant this file is imported —
// before execute() ever runs. handleCommands.ts's dynamic import() only
// console.errors a load failure like that and returns; nothing gets sent
// to the chat, so the bot looks like it's ignoring /shoticron entirely.
// Deferring construction to first actual use, inside a try/catch (see
// getShotiClient() below), means any such error surfaces as a normal
// in-chat error message instead of silently killing the whole command.
let shotiClient: Shoti | null = null;
function getShotiClient(): Shoti {
  if (!shotiClient) {
    shotiClient = new Shoti(process.env.SHOTI_APIKEY);
  }
  return shotiClient;
}

// Keyed by chat id (event.chat.id is a number) — one auto-post loop, one
// custom interval, and one last-error message per chat.
const state: Record<number, boolean> = {};
const interval: Record<number, number> = {};
const lastErr: Record<number, string> = {};

let sent = 0;
let failed = 0;
const DEFAULT_MS = 60 * 60 * 1000;

async function dispatch({ api, event, args }: Execute) {
  // args is already a string[] split on whitespace by the command
  // dispatcher (handleCommands.ts) — no manual parsing needed here.
  if (!args[0]) {
    return api.sendMessage(event.chat.id, `${config.usage}`);
  }
  const sub = args[0].toLowerCase();
  const val = args[1];
  const unit = (args[2] || "").toLowerCase();

  const threadID = event.chat.id;
  const curInterval = interval[threadID] || DEFAULT_MS;

  switch (sub) {
    case "setinterval": {
      const n = parseFloat(val);
      if (isNaN(n) || n <= 0)
        return api.sendMessage(event.chat.id, "⛔ Invalid number.");

      const ms = unit.startsWith("hour")
        ? n * 60 * 60 * 1000
        : unit.startsWith("minute")
          ? n * 60 * 1000
          : NaN;

      if (isNaN(ms)) {
        return api.sendMessage(
          event.chat.id,
          "⛔ Invalid unit. Use 'minutes' or 'hours'.",
        );
      }

      interval[threadID] = ms;
      return api.sendMessage(event.chat.id, `✅ Interval set to ${n} ${unit}.`);
    }

    case "interval":
      return api.sendMessage(
        event.chat.id,
        `⏱ Current interval: ${curInterval / 60000} minute(s).`,
      );

    case "on": {
      if (state[threadID]) {
        return api.sendMessage(
          event.chat.id,
          "ℹ️ Auto-shoti is already running.",
        );
      }

      state[threadID] = true;
      const intervalMS = interval[threadID] || DEFAULT_MS;
      const minutes = intervalMS / 60000;

      await api.sendMessage(
        event.chat.id,
        `✅ Auto-shoti enabled. Sending every ${minutes} minute(s).`,
      );

      await pushOne(api, event);

      const timer = setInterval(() => {
        if (state[threadID]) {
          pushOne(api, event);
        } else {
          clearInterval(timer);
        }
      }, intervalMS);

      return;
    }

    case "off":
      if (!state[threadID]) {
        return api.sendMessage(event.chat.id, "ℹ️ Auto mode is already off.");
      }
      state[threadID] = false;
      return api.sendMessage(event.chat.id, "⛔ Auto-shoti disabled.");

    case "status": {
      const running = state[threadID] ? "ON" : "OFF";
      const minutes = curInterval / 60000;
      const error = lastErr[threadID]
        ? `❌ Last error: ${lastErr[threadID]}`
        : "";

      return api.sendMessage(
        event.chat.id,
        `📊 Auto-Shoti Status: ${running}\n` +
          `✅ Videos sent: ${sent}\n` +
          `❌ Errors: ${failed}\n` +
          `⏱ Interval: ${minutes} minutes\n${error}`,
      );
    }

    case "reset":
      sent = 0;
      failed = 0;
      return api.sendMessage(event.chat.id, "✅ Counters reset successfully.");

    default: {
      await api.sendMessage(event.chat.id, "⏳ Fetching video...");
      try {
        const result = await getShotiClient().getShoti({ type: "video" });

        // getShoti() can resolve to `{ error, code }` instead of throwing
        // on failure — accessing `.user`/`.content` on that shape used to
        // crash with a confusing "Cannot read properties of undefined"
        // instead of surfacing the actual API error. Same fix already
        // applied in shoti.ts/ishoti.ts.
        if ("error" in result) {
          throw new Error(result.error);
        }

        const { user, content } = result;
        const videoUrl = Array.isArray(content) ? content[0] : content;

        // Same guard as pushOne() — see its comment for why a "successful"
        // response can still carry no usable video URL.
        if (!videoUrl) {
          throw new Error(
            "Shoti API returned no video content" +
              ("code" in result ? ` (code: ${result.code})` : ""),
          );
        }

        await api.sendVideo(event.chat.id, videoUrl, {
          caption: `@${user.username}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await api.sendMessage(event.chat.id, `❌ ERROR: ${message}`);
        return false;
      }
    }
  }
}

// Thin wrapper around dispatch() — the actual command logic. This is what
// gets exported and is what handleCommands.ts calls. Its only job is to
// guarantee /shoticron always produces a visible reply: dispatch() already
// catches known failure points (default, pushOne), but this outer
// catch is the backstop for anything else, including getShotiClient()
// throwing on its very first call (e.g. an invalid SHOTI_APIKEY). Without
// this, an uncaught error here would just be a server-side console.error
// with nothing sent to the chat — see handleCommands.ts's importCommand,
// which only logs (and never messages the user) when a command's own code
// throws after loading successfully.
export async function execute(ctx: Execute) {
  try {
    return await dispatch(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[shoticron]", message);
    try {
      await ctx.api.sendMessage(ctx.event.chat.id, `❌ ERROR: ${message}`);
    } catch (sendError) {
      console.error("[shoticron] failed to report error to chat:", sendError);
    }
    return false;
  }
}

async function pushOne(api: TelegramBot, event: Message) {
  try {
    const result = await getShotiClient().getShoti({ type: "video" });

    if ("error" in result) {
      throw new Error(result.error);
    }

    const { user, content } = result;
    const videoUrl = Array.isArray(content) ? content[0] : content;

    // getShoti() can also "succeed" with an empty content array (e.g. a
    // temporary rate limit or exhaustion on the upstream API's side)
    // rather than an explicit `{ error }` shape — that's a distinct
    // failure mode from the "error" in result check above, and without
    // this guard it would silently call sendVideo(chatId, undefined, ...),
    // producing a confusing low-level Telegram/library error instead of
    // a clear, actionable one.
    if (!videoUrl) {
      throw new Error(
        "Shoti API returned no video content" +
          ("code" in result ? ` (code: ${result.code})` : ""),
      );
    }

    await api.sendVideo(event.chat.id, videoUrl, {
      caption: `@${user.username}`,
    });

    sent++;

    // Reaction is best-effort and kept separate from the send above: if
    // this throws (e.g. the triggering /shoticron message has aged out
    // of Telegram's reaction window), it must not roll back the fact
    // that the video already sent successfully — previously this call
    // shared the same try block as sendVideo, so a reaction failure here
    // would fall into the catch below, increment `failed`, and overwrite
    // `lastErr` with a misleading "reaction failed" message even though
    // the video had gone out fine. setMessageReaction *replaces* the
    // reaction set on that message rather than stacking one on top of
    // another, so re-applying the same reaction on every recurring send
    // is harmless — it just keeps confirming "still working". Reaction
    // must be an array of reaction objects, not a JSON string — matches
    // the shape used everywhere else in this project (see
    // handleCommands.ts, autogreetScheduler.ts).
    try {
      await api.setMessageReaction(event.chat.id, event.message_id, {
        reaction: [{ type: "emoji", emoji: "🔥" }],
      });
    } catch (reactionError) {
      console.error("[shoticron] reaction failed:", reactionError);
    }
  } catch (e) {
    failed++;
    const message = e instanceof Error ? e.message : String(e);
    lastErr[event.chat.id] = message;
    console.error("[shoticron]", message);

    // This used to be silent beyond the counters above — from the chat's
    // perspective, a recurring send that fails every tick looked
    // identical to the interval never firing at all. Every other failure
    // path in this file (default) already reports to the chat; this
    // brings the interval's own failures in line with that instead
    // of requiring someone to know to run /shoticron status to find out
    // why nothing's showing up.
    try {
      await api.sendMessage(
        event.chat.id,
        `❌ Auto-shoti send failed: ${message}`,
      );
    } catch (sendError) {
      console.error("[shoticron] failed to report error to chat:", sendError);
    }
  }
}
