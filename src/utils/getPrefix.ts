import { ChatbotConfig } from "@/types";
import { DEFAULT_PREFIX } from "@/config";

export function getPrefix(chatbotConfig: ChatbotConfig): string {
  return chatbotConfig?.prefix || DEFAULT_PREFIX;
}
