import chalk from "chalk";
import { bot } from "@/utils/telegram";
import { wrapBot } from "@/utils/wrapper";
import { chatbotConfig } from "@/config";
import { handleCommands } from "@/utils/handleCommands";
import { handleEvents } from "@/utils/handleEvents";
import { startAutoGreetScheduler } from "@/lib/autogreetScheduler";
import { getBotSetting, deleteBotSetting } from "@/lib/db";
import "@/keep_alive";

// Every command/event below receives this wrapped instance instead of the
// raw bot — it behaves identically but auto-sanitizes MarkdownV2 and applies
// parse_mode: 'MarkdownV2' on every outgoing send/edit call. See
// utils/wrapper.ts and utils/markdown.util.ts (ported from Persian-Bot/Cat-Bot).
const wrappedBot = wrapBot(bot);

const setupChatbot = async () => {
  const { name } = await bot.getMyName();

  // Restores a prefix previously set via /prefix (see src/commands/prefix.ts)
  // so a restart doesn't silently revert to DEFAULT_PREFIX. No row yet
  // (fresh install, or prefix never changed) just means "keep the
  // config.ts default" — not an error.
  try {
    const savedPrefix = await getBotSetting("prefix");
    if (savedPrefix) {
      chatbotConfig.prefix = savedPrefix;
    }
  } catch (error) {
    console.error("Failed to load saved prefix, using default:", error);
  }

  // Same idea for Developer Mode (see src/commands/developer.ts) — an
  // admin who locked the bot down shouldn't have that silently undone by
  // a restart. No row yet means "off", the config.ts default.
  try {
    const savedDeveloperMode = await getBotSetting("developer_mode");
    if (savedDeveloperMode) {
      chatbotConfig.developerMode = savedDeveloperMode === "true";
    }
  } catch (error) {
    console.error("Failed to load saved developer mode, using default:", error);
  }

  await handleCommands(wrappedBot, chatbotConfig);
  console.log(chalk.cyan.bold("[SYSTEM]: Ready to accept user commands!"));

  await handleEvents(wrappedBot, chatbotConfig);
  console.log(chalk.cyan.bold("[SYSTEM]: Ready to accept user events!"));

  // AutoGreet's Morning/Afternoon/Evening/Night broadcast
  // (src/lib/autogreetScheduler.ts) isn't triggered by an incoming Telegram
  // update, so handleEvents() above doesn't wire it up — it's started
  // here instead, once, as its own polling interval.
  startAutoGreetScheduler(wrappedBot);
  console.log(chalk.cyan.bold("[SYSTEM]: AutoGreet scheduler started!"));

  console.log(
    chalk.cyan.bold("[SYSTEM]: Chatbot Name:") +
      " " +
      chalk.black.bold.bgCyan.bold(name),
  );

  // If the previous process exited via /restart (src/commands/restart.ts),
  // it left a note here saying where to confirm. Any other process exit
  // (crash, manual stop, first-ever boot) just finds nothing and moves on
  // silently — this only fires for restarts triggered through the bot.
  try {
    const pending = await getBotSetting("pending_restart");
    if (pending) {
      const { chatId, messageId } = JSON.parse(pending) as {
        chatId: number;
        messageId: number;
      };

      try {
        await wrappedBot.editMessageText("✅ Successfully restarted!", {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (error) {
        // Editing fails if e.g. too much time passed or the message/chat
        // is gone — fall back to a fresh message so the confirmation
        // still lands somewhere.
        console.error("Failed to edit restart confirmation, sending new message:", error);
        await wrappedBot.sendMessage(chatId, "✅ Successfully restarted!");
      }

      await deleteBotSetting("pending_restart");
    }
  } catch (error) {
    console.error("Failed to send restart confirmation:", error);
  }
};

setupChatbot();
