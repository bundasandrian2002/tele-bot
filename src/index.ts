import chalk from "chalk";
import { bot } from "@/utils/telegram";
import { wrapBot } from "@/utils/wrapper";
import { chatbotConfig } from "@/config";
import { handleCommands } from "@/utils/handleCommands";
import { handleEvents } from "@/utils/handleEvents";
import "@/keep_alive";

// Every command/event below receives this wrapped instance instead of the
// raw bot — it behaves identically but auto-sanitizes MarkdownV2 and applies
// parse_mode: 'MarkdownV2' on every outgoing send/edit call. See
// utils/wrapper.ts and utils/markdown.util.ts (ported from Persian-Bot/Cat-Bot).
const wrappedBot = wrapBot(bot);

const setupChatbot = async () => {
  const { name } = await bot.getMyName();

  await handleCommands(wrappedBot, chatbotConfig);
  console.log(chalk.cyan.bold("[SYSTEM]: Ready to accept user commands!"));

  await handleEvents(wrappedBot, chatbotConfig);
  console.log(chalk.cyan.bold("[SYSTEM]: Ready to accept user events!"));

  console.log(
    chalk.cyan.bold("[SYSTEM]: Chatbot Name:") +
      " " +
      chalk.black.bold.bgCyan.bold(name),
  );
};

setupChatbot();
