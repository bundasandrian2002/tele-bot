export const DEFAULT_PREFIX = "/";
import { ChatbotConfig } from "@/types";

// Fallback defaults only — src/bot/manager.ts builds each tenant's real
// ChatbotConfig (admins, prefix, botname, developerMode) from that
// instance's own bot_instance_settings rows instead of this object, so one
// user's bot never inherits another's admin list.
export const chatbotConfig: ChatbotConfig = {
  admins: [],
  prefix: DEFAULT_PREFIX,
  botname: "stella",
  developerMode: false,
};
