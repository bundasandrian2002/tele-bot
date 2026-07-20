import { Config, Execute } from "@/types";
import { getPrefix } from "@/utils/getPrefix";
import { setBotSetting } from "@/lib/db";

export const config: Config = {
  name: "prefix",
  description:
    "Show the bot's current command prefix, or (admin only) change it. The new prefix takes effect immediately for every command.",
  usage: "/prefix [newPrefix]",
  permission: "user",
  creator: "itsunknown",
};

// Keeps the prefix short and free of characters that would make commands
// ambiguous to parse (whitespace) or annoying to type. Anything else
// (/, !, ., ?, multi-char prefixes like "bot!") is fine.
const MAX_PREFIX_LENGTH = 5;

export async function execute({ api, event, args, chatbotConfig }: Execute) {
  const currentPrefix = getPrefix(chatbotConfig);

  // No args: just report the current prefix, available to everyone.
  if (!args.length) {
    await api.sendMessage(
      event.chat.id,
      `🔧 *Current Prefix:* \`${currentPrefix}\`\n\n` +
        `Example: \`${currentPrefix}help\``,
    );
    return;
  }

  // Changing the prefix is bot-admin only — everyone else just gets the
  // read-only path above. Checked here (rather than via config.permission)
  // because the command itself is otherwise open to all users.
  if (!event.from || !chatbotConfig.admins.includes(event.from.id)) {
    await api.sendMessage(
      event.chat.id,
      "⚠️ Only an admin can change the prefix.",
    );
    return false;
  }

  const newPrefix = args[0];

  if (/\s/.test(newPrefix)) {
    await api.sendMessage(
      event.chat.id,
      "❌ Prefix can't contain whitespace.",
    );
    return false;
  }

  if (newPrefix.length > MAX_PREFIX_LENGTH) {
    await api.sendMessage(
      event.chat.id,
      `❌ Prefix is too long. Keep it under ${MAX_PREFIX_LENGTH} characters.`,
    );
    return false;
  }

  if (newPrefix === currentPrefix) {
    await api.sendMessage(
      event.chat.id,
      `ℹ️ Prefix is already \`${currentPrefix}\`.`,
    );
    return;
  }

  // Mutated in place rather than reassigned: chatbotConfig is a single
  // object reference shared by handleCommands/handleEvents at startup
  // (see src/index.ts), so every module holding that reference needs to
  // see the update immediately, without waiting on the DB write below.
  chatbotConfig.prefix = newPrefix;

  try {
    // Persisted so a restart picks it back up via the bot_settings lookup
    // in src/index.ts, instead of reverting to DEFAULT_PREFIX.
    await setBotSetting("prefix", newPrefix);
  } catch (error) {
    console.error("Failed to persist new prefix:", error);
    await api.sendMessage(
      event.chat.id,
      `⚠️ Prefix changed to \`${newPrefix}\` for now, but saving it failed — it may revert after a restart.`,
    );
    return;
  }

  await api.sendMessage(
    event.chat.id,
    `✅ *Prefix Updated!*\n\n` +
      `Old: \`${currentPrefix}\`\n` +
      `New: \`${newPrefix}\`\n\n` +
      `Example: \`${newPrefix}help\``,
  );
}
