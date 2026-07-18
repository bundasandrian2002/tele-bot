import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";

const bot_token = process.env.BOT_TOKEN;

if (!bot_token) {
  throw new Error("Pleasse specify your bot token on environment variables.");
}

export const bot = new TelegramBot(bot_token, {
  polling: true,
});
