import { EventConfig, EventExecute } from "@/types";
import { generateGreetCard } from "@/lib/greetCard";
import { getAvatarUrl } from "@/lib/getAvatarUrl";

export const config: EventConfig = {
  name: "leave",
  description:
    "Sends a goodbye card when a member leaves, or is removed/kicked from the group.",
  creator: "itsunknown",
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

    const [avatarUrl, memberCount] = await Promise.all([
      getAvatarUrl(api, member.id),
      api.getChatMemberCount(event.chat.id).catch(() => null),
    ]);

    const card = await generateGreetCard({
      type: "goodbye",
      username: displayName,
      avatarUrl,
      serverName: event.chat.title ?? null,
      message: wasRemoved ? `Removed by ${remover ?? "an admin"}` : null,
      memberCount,
    });

    const caption = wasRemoved
      ? `👋 *${displayName}* was removed from the group by *${remover ?? "an admin"}*.`
      : `👋 *${displayName}* has left the group. Take care!`;

    await api.sendPhoto(
      event.chat.id,
      card,
      { caption },
      { filename: "goodbye.png", contentType: "image/png" },
    );
  } catch (error) {
    console.error("leave event error:", error);
  }
}
