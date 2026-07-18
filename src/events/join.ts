import { EventConfig, EventExecute } from "@/types";
import { generateGreetCard } from "@/lib/greetCard";
import { getAvatarUrl } from "@/lib/getAvatarUrl";

export const config: EventConfig = {
  name: "join",
  description: "Sends a welcome card when a new member joins the group.",
  creator: "AjiroDesu",
  // node-telegram-bot-api re-emits certain message subtypes as their own
  // event names — "new_chat_members" fires whenever one or more users
  // are added to the group, so it maps straight onto this event.
  trigger: "new_chat_members",
};

export async function execute({ api, event }: EventExecute) {
  try {
    const newMembers = event.new_chat_members;
    if (!newMembers?.length) return;

    const me = await api.getMe();
    const chatTitle = event.chat.title ?? "the group";

    // Member count doesn't change per-member within this loop, so fetch it
    // once rather than once per new member.
    const memberCount = await api.getChatMemberCount(event.chat.id).catch(() => null);

    for (const member of newMembers) {
      // The bot adding itself to a group also fires new_chat_members —
      // that's not someone to welcome.
      if (member.id === me.id) continue;

      const displayName = member.last_name
        ? `${member.first_name} ${member.last_name}`
        : member.first_name;

      const avatarUrl = await getAvatarUrl(api, member.id);
      const card = await generateGreetCard({
        type: "welcome",
        username: displayName,
        avatarUrl,
        serverName: chatTitle,
        memberCount,
      });

      // Kept outside the *bold* span below — the sanitizer's span parser
      // doesn't handle nested entities, so a [text](url) link embedded
      // inside *bold* would get its brackets escaped as literal text.
      const mention = `[${displayName}](tg://user?id=${member.id})`;

      await api.sendPhoto(
        event.chat.id,
        card,
        {
          caption:
            `👋 *Welcome,* ${mention}*!*\n\n` +
            `Glad to have you in *${chatTitle}*. Make yourself at home 🎉`,
        },
        { filename: "welcome.png", contentType: "image/png" },
      );
    }
  } catch (error) {
    console.error("join event error:", error);
  }
}
