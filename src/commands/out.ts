import { Config, Execute } from "@/types";

export const config: Config = {
  name: "out",
  description: "Makes the bot leave the current group.",
  usage: "/out",
  permission: "admin",
  creator: "itsunknown",
};

export async function execute({ api, event }: Execute) {
  // Group-only: leaving a 1:1 chat with the bot, or a channel, doesn't
  // make sense the same way leaving a group does.
  if (event.chat.type !== "group" && event.chat.type !== "supergroup") {
    await api.sendMessage(
      event.chat.id,
      "🚫 *Only Group Allowed!*\n\nThis command can only be used in a group chat.",
    );
    return false;
  }

  try {
    await api.sendMessage(
      event.chat.id,
      "👋 Alright, I'm leaving the group. Bye!",
    );
    await api.leaveChat(event.chat.id);
  } catch (error: any) {
    console.error(error);
    await api.sendMessage(event.chat.id, "❌ Failed to leave the group.");
    return false;
  }
}
