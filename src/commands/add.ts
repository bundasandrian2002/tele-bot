import { Config, Execute } from "@/types";
import "dotenv/config";
import Shoti from "showty";

export const config: Config = {
  name: "add",
  description: "Add a new URL to the Shoti database.",
  usage: "/add [url]",
  permission: "admin",
  creator: "libyzxy0",
};

// Same pattern as shoti.ts/ishoti.ts — surface a clear cause in the logs
// at startup rather than a confusing auth failure the first time /add runs.
if (!process.env.SHOTI_APIKEY) {
  console.error(
    "[add] SHOTI_APIKEY is not set — the /add command will fail until it's added to your environment variables.",
  );
}

// The rest of the Shoti-family commands in this project (shoti.ts, ishoti.ts)
// import from "showty" — that's the package actually listed in package.json,
// not "shoti". Using the same package/instance here keeps /add talking to
// the same client the rest of the bot already depends on.
const shoti = new Shoti(process.env.SHOTI_APIKEY);

export async function execute({ api, event, args }: Execute) {
  // args is already a string[] split on whitespace by the command
  // dispatcher (handleCommands.ts) — no manual parsing needed here, and a
  // URL isn't expected to contain spaces, so the first token is the URL.
  const url = args[0];

  if (!url) {
    await api.sendMessage(
      event.chat.id,
      `⚠️ *Invalid Command!*\n\nUsage: \`${config.usage}\``,
    );
    return false;
  }

  try {
    const data = await shoti.newShoti({ url });

    // Wrapped in a fenced code block on purpose: the outgoing-message
    // wrapper (utils/wrapper.ts) auto-applies MarkdownV2 and escapes
    // reserved characters, but a ``` block is one of the spans it
    // preserves verbatim (aside from backticks/backslashes) — see
    // markdown.util.ts — so the JSON renders exactly as formatted below
    // instead of getting escaped into unreadable text. No explicit
    // parse_mode override needed; the wrapper's MarkdownV2 default handles it.
    await api.sendMessage(
      event.chat.id,
      "*API Response*\n\n```json\n" + JSON.stringify(data, null, 2) + "\n```",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[add]", message);
    await api.sendMessage(event.chat.id, "❌ Failed to add that URL.");
    return false;
  }
}
