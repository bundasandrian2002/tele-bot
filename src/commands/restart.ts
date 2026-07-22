import { Config, Execute } from "@/types";
import { getBotInstance } from "@/lib/db";
import { botManager } from "@/bot/manager";

export const config: Config = {
  name: "restart",
  description:
    "Reconnects this bot to Telegram (drops and re-opens its polling connection). " +
    "Under the multi-user dashboard this only restarts your own bot, not anyone else's.",
  usage: "/restart",
  permission: "admin",
  creator: "itsunknown",
};

export async function execute({ api, event, chatbotConfig }: Execute) {
  if (chatbotConfig.instanceId === undefined) {
    await api.sendMessage(
      event.chat.id,
      "❌ This bot isn't running under the multi-user manager, so it doesn't know how to restart itself safely.",
    );
    return false;
  }

  const instance = await getBotInstance(chatbotConfig.instanceId);
  if (!instance) {
    await api.sendMessage(event.chat.id, "❌ Couldn't find this bot's instance record.");
    return false;
  }

  await api.sendMessage(event.chat.id, "🔄 Restarting this bot's connection...");

  setTimeout(() => {
    botManager.restart(instance).catch((error) => {
      console.error(`[restart] Failed to restart instance ${instance.id}:`, error);
    });
  }, 500);
}
