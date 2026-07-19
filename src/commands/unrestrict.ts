import { Config, Execute } from "@/types";
import { resolveTargetUser } from "@/utils/resolveTargetUser";

export const config: Config = {
  name: "unrestrict",
  description:
    "Lifts a member's restrictions, restoring their ability to send messages/media. Target them by replying to one of their messages, or by @mentioning them.",
  usage: "/unrestrict (reply to a user) OR /unrestrict @username",
  permission: "admin",
  creator: "itsunknown",
};

export async function execute({ api, event }: Execute) {
  try {
    // Group-only, same as restrict — there's nothing to lift in a
    // 1:1 chat with the bot.
    if (event.chat.type !== "group" && event.chat.type !== "supergroup") {
      await api.sendMessage(
        event.chat.id,
        "🚫 *Only Group Allowed!*\n\nThis command can only be used in the group chat.",
      );
      return false;
    }

    const target = await resolveTargetUser(api, event);

    if (!target) {
      await api.sendMessage(
        event.chat.id,
        "⚠️ *No Target Found!*\n\n" +
          "Reply to the user's message with `/unrestrict`, or mention them directly, e.g. `/unrestrict @username`.",
      );
      return false;
    }

    const me = await api.getMe();
    if (target.id === me.id) {
      await api.sendMessage(event.chat.id, "🤖 I'm not restricted.");
      return false;
    }

    const targetMember = await api.getChatMember(event.chat.id, target.id);
    const displayName = target.last_name
      ? `${target.first_name} ${target.last_name}`
      : target.first_name;

    // Nothing to lift for a member who isn't currently restricted —
    // say so instead of silently sending a no-op API call.
    if (targetMember.status !== "restricted") {
      await api.sendMessage(
        event.chat.id,
        `ℹ️ *${displayName}* isn't currently restricted.`,
      );
      return false;
    }

    // Restores every permission restrict.ts turns off, handing the
    // member back full standard messaging ability.
    await api.restrictChatMember(event.chat.id, target.id, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_react_to_messages: true,
    });

    await api.sendMessage(
      event.chat.id,
      `🔊 *${displayName}* has been unrestricted.`,
    );
  } catch (error: any) {
    if (error?.response?.body?.description?.includes("not enough rights")) {
      await api.sendMessage(
        event.chat.id,
        "🚫 I need admin rights (with permission to restrict members) to do that.",
      );
      return false;
    }

    console.error(error);
    await api.sendMessage(
      event.chat.id,
      "❌ Failed to unrestrict the selected user.",
    );
    return false;
  }
}
