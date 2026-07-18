import { Config, Execute } from "@/types";
import { resolveTargetUser } from "@/utils/resolveTargetUser";

export const config: Config = {
  name: "kick",
  description:
    "Removes a member from the group. Target them by replying to one of their messages, or by @mentioning them.",
  usage: "/kick (reply to a user) OR /kick @username",
  permission: "admin",
  creator: "AjiroDesu",
};

export async function execute({ api, event }: Execute) {
  try {
    // Group-only: kicking someone out of a 1:1 chat with the bot, or
    // out of a channel, doesn't make sense.
    if (event.chat.type !== "group" && event.chat.type !== "supergroup") {
      await api.sendMessage(
        event.chat.id,
        "🚫 *Group Only*\n\nThis command can only be used in a group chat.",
      );
      return false;
    }

    const target = await resolveTargetUser(api, event);

    if (!target) {
      await api.sendMessage(
        event.chat.id,
        "⚠️ *No Target Found!*\n\n" +
          "Reply to the user's message with `/kick`, or mention them directly, e.g. `/kick @username`.",
      );
      return false;
    }

    const me = await api.getMe();
    if (target.id === me.id) {
      await api.sendMessage(event.chat.id, "🤖 I can't kick myself.");
      return false;
    }

    if (target.id === event.from?.id) {
      await api.sendMessage(event.chat.id, "🙃 You can't kick yourself.");
      return false;
    }

    // Refuse to kick the chat's creator/admins rather than letting the
    // API bounce it with a raw error — this is a friendlier message
    // and avoids a bot-vs-bot admin permission edge case entirely.
    const targetMember = await api.getChatMember(event.chat.id, target.id);
    if (
      targetMember.status === "creator" ||
      targetMember.status === "administrator"
    ) {
      await api.sendMessage(
        event.chat.id,
        "🛡️ I can't kick a group admin or the creator.",
      );
      return false;
    }

    const displayName = target.last_name
      ? `${target.first_name} ${target.last_name}`
      : target.first_name;

    // "Kick" = ban immediately followed by unban, so the member is
    // removed from the group but isn't permanently banned and can
    // rejoin later if invited/re-added.
    await api.banChatMember(event.chat.id, target.id);
    await api.unbanChatMember(event.chat.id, target.id, {
      only_if_banned: true,
    });

    await api.sendMessage(
      event.chat.id,
      `👢 *${displayName}* has been kicked out from the group.`,
    );
  } catch (error: any) {
    // Most common real-world failure: the bot itself isn't a group
    // admin (or lacks the "restrict members" right), which Telegram
    // reports as a "not enough rights" 400 error.
    if (error?.response?.body?.description?.includes("not enough rights")) {
      await api.sendMessage(
        event.chat.id,
        "🚫 I need admin rights (with permission to ban users) to do that.",
      );
      return false;
    }

    console.error(error);
    await api.sendMessage(
      event.chat.id,
      "❌ Failed to kick the selected user.",
    );
    return false;
  }
}
