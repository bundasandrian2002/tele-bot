import { Config, Execute } from "@/types";
import { setBotSetting } from "@/lib/db";

export const config: Config = {
  name: "developer",
  description:
    "Toggle Developer Mode. While on, only bot admins can use commands or trigger " +
    "user-facing features (autodl, autogreet, the AI agent, rankup) — everyone else is " +
    "turned away with a clear message. Moderation/membership events (autokick, join, " +
    "leave) keep running regardless.",
  usage: "/developer [on|off|status]",
  permission: "admin",
  creator: "itsunknown",
};

export async function execute({ api, event, args, chatbotConfig }: Execute) {
  const sendStatus = () =>
    api.sendMessage(
      event.chat.id,
      `*Developer Mode:* is currently ${
        chatbotConfig.developerMode ? "enabled" : "disabled"
      }.`,
    );

  // No args: report current status rather than guessing an action.
  if (!args.length) {
    await sendStatus();
    return;
  }

  const arg = args[0].toLowerCase();
  let next: boolean;

  if (arg === "status") {
    await sendStatus();
    return;
  } else if (arg === "on") {
    next = true;
  } else if (arg === "off") {
    next = false;
  } else if (arg === "toggle") {
    next = !chatbotConfig.developerMode;
  } else {
    await api.sendMessage(
      event.chat.id,
      "❌ Usage: `/developer on`, `/developer off`, `/developer status`.",
    );
    return false;
  }

  if (next === !!chatbotConfig.developerMode) {
    await api.sendMessage(
      event.chat.id,
      next
        ? "ℹ️ Developer Mode is already ON."
        : "ℹ️ Developer Mode is already OFF.",
    );
    return;
  }

  // Mutated in place, same reasoning as prefix.ts: chatbotConfig is one
  // shared object reference across handleCommands/handleEvents, so a plain
  // property write here is visible everywhere immediately.
  chatbotConfig.developerMode = next;

  try {
    // Persisted so a restart doesn't silently drop back to OFF — loaded
    // back in src/index.ts on startup, same pattern as the saved prefix.
    await setBotSetting("developer_mode", next ? "true" : "false");
  } catch (error) {
    console.error("Failed to persist developer mode:", error);
    await api.sendMessage(
      event.chat.id,
      `⚠️ Developer Mode is now ${next ? "ON" : "OFF"} for now, but saving it failed — it may revert after a restart.`,
    );
    return;
  }

  await api.sendMessage(
    event.chat.id,
    next
      ? "🔒 *Developer Mode Enabled!* \n\nOnly admins can use commands or trigger AI/auto-features."
      : "🔓 *Developer Mode Disabled!* \n\nEveryone can use the bot.",
  );
}
