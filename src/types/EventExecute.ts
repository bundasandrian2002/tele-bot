import TelegramBot, { Message } from "node-telegram-bot-api";
import { ChatbotConfig } from "./ChatbotConfig";

export type EventExecute = {
  api: TelegramBot;
  event: Message;
  chatbotConfig: ChatbotConfig;
};
