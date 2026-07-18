import { EventConfig, EventExecute } from "@/types";

export const config: EventConfig = {
  name: "leave",
  description:
    "Sends a goodbye message when a member leaves, or is removed/kicked from the group.",
  creator: "AjiroDesu",
  // Fires when a single member leaves on their own OR is removed/kicked
  // by an admin — Telegram reports both through the same field.
  trigger: "left_chat_member",
};

export async function execute({ api, event }: EventExecute) {
  try {
    const member = event.left_chat_member;
    if (!member) return;

    const me = await api.getMe();
    // Bot being removed from the group also fires left_chat_member —
    // nothing to send in that case, since it's no longer in the chat.
    if (member.id === me.id) return;

    const displayName = member.last_name
      ? `${member.first_name} ${member.last_name}`
      : member.first_name;

    // Telegram reports a self-initiated leave and an admin kick through
    // the same field: `from` is the actor, `left_chat_member` is the
    // target. They only differ when someone else removed the member.
    const wasRemoved = !!event.from && event.from.id !== member.id;
    const remover = event.from?.last_name
      ? `${event.from.first_name} ${event.from.last_name}`
      : event.from?.first_name;

    const text = wasRemoved
      ? `👋 *${displayName}* was removed from the group by *${remover ?? "an admin"}*.`
      : `👋 *${displayName}* has left the group. Take care!`;

    await api.sendMessage(event.chat.id, text);
  } catch (error) {
    console.error("leave event error:", error);
  }
}
