import { ChatbotConfig, Config, Execute } from "@/types";
import TelegramBot, { CallbackQuery, Message } from "node-telegram-bot-api";
import { handleHelpCallback } from "@/commands/help";
import { getPrefix } from "@/utils/getPrefix";
import { startTypingIndicator } from "@/utils/typingIndicator";

export const handleCommands = (
  bot: TelegramBot,
  chatbotConfig: ChatbotConfig,
) => {
  bot.on("message", async (message: Message) => {
    try {
      const prefix = getPrefix(chatbotConfig);
      const text = message?.text?.trim();
      if (!text?.startsWith(prefix)) return;

      const txt = text.split(/\s+/).filter(Boolean);
      txt[0] = txt[0].split("@")[0].toLowerCase();

      const command = txt[0];
      const args = txt.slice(1);
      const commandName = command.slice(prefix.length);

      if (!commandName) return;

      // help now lives at src/commands/help.ts like every other
      // command, so it's dispatched the same way — no special case.
      await importCommand(commandName, bot, message, args, chatbotConfig);
    } catch (error) {
      console.error("Message handling error:", error);
    }
  });

  // Handles inline keyboard interactions (e.g. help pagination controls).
  // These arrive as callback_query updates, not messages, so they don't
  // go through the command dispatcher above and need to be routed here.
  bot.on("callback_query", async (query: CallbackQuery) => {
    try {
      const data = query.data;
      if (!data) return;

      if (data.startsWith("help_")) {
        await handleHelpCallback(bot, query, chatbotConfig);
      }
    } catch (error) {
      console.error("Callback query handling error:", error);
    }
  });
};

const importCommand = async (
  commandName: string,
  bot: TelegramBot,
  message: Message,
  args: string[],
  chatbotConfig: ChatbotConfig,
) => {
  const prefix = getPrefix(chatbotConfig);
  let mod: { execute?: (ctx: Execute) => Promise<any>; config?: Config };

  // Covers the entire processing window for this command — from resolving
  // which command file to load, through permission checks, all the way to
  // the command's own execute() finishing (success or failure). Started
  // here (rather than a one-off sendChatAction per command) so the
  // indicator keeps refreshing itself for however long processing
  // actually takes, instead of a hardcoded duration, and is guaranteed to
  // stop via the `finally` below regardless of which path this takes.
  const stopTyping = startTypingIndicator(bot, message.chat.id);

  try {
    try {
      mod = await import(`@/commands/${commandName}`);
    } catch (error: any) {
      // Dynamic import throws ERR_MODULE_NOT_FOUND when there's no
      // src/commands/<name>.ts for the typed command — that's a user
      // typo, not a bug, so tell them instead of just logging it.
      if (error?.code === "ERR_MODULE_NOT_FOUND") {
        await sendCommandNotFound(bot, message, commandName, prefix);
      } else {
        console.error(`Error loading '${commandName}':`, error);
      }
      return;
    }

    const { execute, config } = mod;

    if (!config) {
      console.error(`Command '${commandName}' is missing a config.`);
      return;
    }

    try {
      await runCommand(config, execute!, bot, message, args, chatbotConfig);
    } catch (error) {
      console.error(`Error executing '${commandName}':`, error);
    }
  } finally {
    stopTyping();
  }
};

async function sendCommandNotFound(
  bot: TelegramBot,
  message: Message,
  commandName: string,
  prefix: string,
) {
  try {
    // The message wrapper (utils/wrapper.ts) sanitizes this for MarkdownV2 and
    // applies parse_mode automatically — no manual escaping needed here.
    await bot.sendMessage(
      message.chat.id,
      `🚫 *Command Not Found!*\n\n` +
        `\`${prefix}${commandName}\` doesn't exist.\n` +
        `Send \`${prefix}help\` to see the full command list.`,
    );
  } catch (error) {
    console.error("Failed to send command-not-found message:", error);
  }
}

/**
 * Shared permission check + dispatch, used for every command loaded from
 * src/commands (help.ts included — it's just another command file now).
 */
const runCommand = async (
  config: Config,
  execute: (ctx: Execute) => Promise<any>,
  bot: TelegramBot,
  message: Message,
  args: string[],
  chatbotConfig: ChatbotConfig,
) => {
  try {
    if (!message.from) return;

    // Developer Mode locks the *entire* bot to admins, regardless of the
    // command's own `permission` — checked first so it doesn't matter
    // whether the command below would otherwise be user- or admin-only.
    if (
      chatbotConfig.developerMode &&
      !chatbotConfig.admins.includes(message.from.id)
    ) {
      bot.setMessageReaction(message.chat.id, message.message_id, {
        reaction: [{ type: "emoji", emoji: "🔒" }],
      });
      bot.sendMessage(
        message.chat.id,
        "🔒 *Developer Mode is active!* \n\nOnly bot admins can use commands right now.",
      );
      return;
    }

    if (
      config.permission &&
      config.permission == "admin" &&
      !chatbotConfig.admins.includes(message?.from.id)
    ) {
      bot.setMessageReaction(message.chat.id, message.message_id, {
        reaction: [
          {
            type: "emoji",
            emoji: "😂",
          },
        ],
      });
      bot.sendMessage(message.chat.id, "⚠️ Only admin can use this command!");
      return;
    }

    // Commands report their own outcome by return value: explicitly
    // returning `false` means "this failed/errored, don't react" —
    // anything else (including no return value at all) means it
    // completed successfully. That keeps the reaction driven by each
    // command's real result instead of a reaction hardcoded to always
    // fire regardless of outcome.
    const result = await execute({
      api: bot,
      event: message,
      args,
      chatbotConfig,
    });

    if (result !== false) {
      try {
        await bot.setMessageReaction(message.chat.id, message.message_id, {
          reaction: [{ type: "emoji", emoji: "🔥" }],
        });
      } catch (reactionError) {
        // A reaction failing to apply (e.g. the bot left the chat as
        // part of the command it just ran) shouldn't be treated as the
        // command itself having failed.
        console.error(`Failed to react to '${config.name}':`, reactionError);
      }
    }
  } catch (error) {
    // The command threw instead of reporting failure via return value —
    // still an error, so no reaction here either.
    console.error(`Error executing '${config.name}':`, error);
  }
};
