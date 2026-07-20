import { Config, Execute } from "@/types";

export const config: Config = {
  name: "prefix",
  description: "View or change the bot's command prefix.",
  usage: "/prefix [new_prefix]",
  permission: "admin",
  creator: "itsunknown",
};

export async function execute({ api, event, args, chatbotConfig }: Execute) {
  const currentPrefix = chatbotConfig.prefix;

  // No argument — show the current prefix.
  if (!args[0]) {
    await api.sendMessage(
      event.chat.id,
      `⚙️ *Current Prefix*\n\n` +
        `The bot's prefix is currently set to: \`${currentPrefix}\`\n\n` +
        `To change it, use: \`${currentPrefix}prefix <new_prefix>\``,
    );
    return;
  }

  const newPrefix = args[0];

  if (newPrefix.length > 5) {
    await api.sendMessage(
      event.chat.id,
      `❌ *Invalid Prefix!*\n\nPrefix must be 5 characters or fewer.`,
    );
    return false;
  }

  const oldPrefix = chatbotConfig.prefix;
  chatbotConfig.prefix = newPrefix;

  await api.sendMessage(
    event.chat.id,
    `✅ *Prefix Updated!*\n\n` +
      `Old prefix: \`${oldPrefix}\`\n` +
      `New prefix: \`${newPrefix}\`\n\n` +
      `All commands now use \`${newPrefix}\` as the prefix.`,
  );
}
