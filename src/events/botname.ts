import { EventConfig, EventExecute } from "@/types";
import { runAgent } from "@/utils/agent";

export const config: EventConfig = {
  name: "botname",
  description:
    "Passively triggers the AI agent whenever an ordinary message mentions the bot's " +
    "configured nickname — no /ai prefix needed.",
  creator: "itsunknown",
  // Passive watcher, same shape as autodl/autokick: looks at every ordinary
  // message and decides for itself whether the nickname was mentioned.
  trigger: "message",
  // Messages starting with the command prefix (including "/ai ...") are
  // already routed to their own command by handleCommands.ts — skip those
  // here so a nickname mention doesn't trigger the agent a second time.
  skipCommandPrefix: true,
};

export async function execute({ api, event, chatbotConfig }: EventExecute) {
  try {
    const text = event.text?.trim();
    if (!text) return;

    const botname = chatbotConfig.botname?.trim();
    if (!botname) return;

    if (!text.toLowerCase().includes(botname.toLowerCase())) return;

    // runAgent keeps the "typing…" indicator refreshed for its whole turn,
    // so no one-off sendChatAction is needed here.
    const result = await runAgent(text, api, event, chatbotConfig);
    // send_result (if the agent used it) already delivered the reply
    // directly — an empty string here just means "nothing more to send".
    if (result) {
      await api.sendMessage(event.chat.id, result);
    }
  } catch (error) {
    console.error(error);
  }
}
