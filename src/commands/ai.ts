import { Config, Execute } from "@/types";
import { runAgent } from "@/utils/agent";

export const config: Config = {
  name: "ai",
  description:
    "Chat with the AI assistant — it can also run this bot's other commands on your behalf.",
  usage: "/ai [prompt]",
  permission: "user",
  creator: "AjiroDesu",
};

export async function execute({ api, event, args, chatbotConfig }: Execute) {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    await api.sendMessage(event.chat.id, `Usage: ${config.usage}`);
    return false;
  }

  try {
    // runAgent keeps the "typing…" indicator refreshed for its whole turn,
    // so no one-off sendChatAction is needed here.
    const result = await runAgent(prompt, api, event, chatbotConfig);
    // send_result (if the agent used it) already delivered the reply
    // directly — an empty string here just means "nothing more to send".
    if (result) {
      await api.sendMessage(event.chat.id, result);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await api.sendMessage(event.chat.id, `❌ AI Error: ${messageText}`);
    return false;
  }
}
