import { Config, Execute } from "@/types";
import "dotenv/config";
import TelegramBot, { Message } from "node-telegram-bot-api";
import Shoti from "showty";

export const config: Config = {
  name: "shoticron",
  description: "Automatically generate a random video from TikTok on a recurring interval.",
  usage: "/shoticron <on|off|status|setinterval|interval|reset|top>",
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

// The rest of the Shoti-family commands in this project (shoti.ts, ishoti.ts,
// add.ts) import from "showty" — that's the package actually listed in
// package.json, not "shoti". Using the same package/instance here keeps
// /shoticron talking to the same client the rest of the bot already depends on.
const shoti = new Shoti(process.env.SHOTI_APIKEY);

// Keyed by chat id (event.chat.id is a number) — one auto-post loop, one
// custom interval, and one last-error message per chat.
const state: Record<number, boolean> = {};
const interval: Record<number, number> = {};
const lastErr: Record<number, string> = {};

let sent = 0;
let failed = 0;
const DEFAULT_MS = 60 * 60 * 1000;

export async function execute({ api, event, args }: Execute) {
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

    case "top": {
      try {
        const topUsers = await shoti.getTop();
        // Fenced code block on purpose — the outgoing-message wrapper
        // (utils/wrapper.ts) auto-applies MarkdownV2 and escapes reserved
        // characters, but a ``` block is one of the spans it preserves
        // verbatim (aside from backticks/backslashes) — see
        // markdown.util.ts — so the JSON renders as formatted instead of
        // getting escaped into unreadable text.
        return api.sendMessage(
          event.chat.id,
          "🏆 *Top users*\n\n```json\n" + JSON.stringify(topUsers, null, 2) + "\n```",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        api.sendMessage(event.chat.id, "❌ Failed to fetch top users: " + message);
        return false;
      }
    }

    default: {
      await api.sendMessage(event.chat.id, "⏳ Fetching video...");
      try {
        const result = await shoti.getShoti({ type: "video" });

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

async function pushOne(api: TelegramBot, event: Message) {
  try {
    const result = await shoti.getShoti({ type: "video" });

    if ("error" in result) {
      throw new Error(result.error);
    }

    const { user, content } = result;
    const videoUrl = Array.isArray(content) ? content[0] : content;

    await api.sendVideo(event.chat.id, videoUrl, {
      caption: `@${user.username}`,
    });

    // ✅ React to the triggering /shoticron message with 🔥 on every
    // successful auto-post. setMessageReaction *replaces* the reaction set
    // on that message rather than stacking one on top of another, so
    // re-applying the same reaction on every recurring send is harmless —
    // it just keeps confirming "still working" rather than piling up
    // duplicate reactions. Reaction must be an array of reaction objects,
    // not a JSON string — matches the shape used everywhere else in this
    // project (see handleCommands.ts, autogreetScheduler.ts).
    await api.setMessageReaction(event.chat.id, event.message_id, {
      reaction: [{ type: "emoji", emoji: "🔥" }],
    });

    sent++;
  } catch (e) {
    failed++;
    const message = e instanceof Error ? e.message : String(e);
    lastErr[event.chat.id] = message;
    console.error("[shoticron]", message);
  }
}
