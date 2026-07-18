import TelegramBot, { Message } from "node-telegram-bot-api";
import { ChatbotConfig } from "./ChatbotConfig";

export type Execute = {
  api: TelegramBot;
  event: Message;
  args: string[];
  chatbotConfig: ChatbotConfig;
};
