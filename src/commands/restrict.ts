import { Config, Execute } from "@/types";
import { resolveTargetUser } from "@/utils/resolveTargetUser";

export const config: Config = {
  name: "restrict",
  description:
    "Restricts a member from sending messages/media in the group. Target them by replying to one of their messages, or by @mentioning them. Optionally add a duration (e.g. 10m, 2h, 1d) — omit it to restrict indefinitely.",
  usage:
    "/restrict (reply to a user) [duration] OR /restrict @username [duration]",
  permission: "admin",
  creator: "itsunknown",
};

// Accepts a trailing "<number><unit>" argument, e.g. "10m", "2h", "1d".
// Anything that doesn't match is treated as "no duration given" rather
// than an error, since duration is optional.
const DURATION_RE = /^(\d+)(s|m|h|d)$/i;
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

function parseDurationSeconds(args: string[]): number | undefined {
  const last = args[args.length - 1];
  if (!last) return undefined;

  const match = last.match(DURATION_RE);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * UNIT_SECONDS[unit];
}

export async function execute({ api, event, args }: Execute) {
  try {
    // Group-only: there are no "members" to restrict permissions for
    // in a 1:1 chat with the bot.
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
          "Reply to the user's message with `/restrict`, or mention them directly, e.g. `/restrict @username`.",
      );
      return false;
    }

    const me = await api.getMe();
    if (target.id === me.id) {
      await api.sendMessage(event.chat.id, "🤖 I can't restrict myself.");
      return false;
    }

    if (target.id === event.from?.id) {
      await api.sendMessage(event.chat.id, "🙃 You can't restrict yourself.");
      return false;
    }

    const targetMember = await api.getChatMember(event.chat.id, target.id);
    if (
      targetMember.status === "creator" ||
      targetMember.status === "administrator"
    ) {
      await api.sendMessage(
        event.chat.id,
        "🛡️ I can't restrict a group admin or the creator.",
      );
      return false;
    }

    const durationSeconds = parseDurationSeconds(args);
    const untilDate = durationSeconds
      ? Math.floor(Date.now() / 1000) + durationSeconds
      : undefined;

    // Muting = every "can_send_*" permission off. can_add_web_page_previews,
    // can_change_info, can_invite_users, can_pin_messages, and
    // can_manage_topics are left alone since those aren't messaging
    // permissions and restricting them isn't part of a "mute".
    await api.restrictChatMember(
      event.chat.id,
      target.id,
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_react_to_messages: false,
      },
      untilDate ? { until_date: untilDate } : {},
    );

    const displayName = target.last_name
      ? `${target.first_name} ${target.last_name}`
      : target.first_name;
    const durationText = durationSeconds
      ? `for *${args[args.length - 1]}*`
      : "indefinitely";

    await api.sendMessage(
      event.chat.id,
      `🔇 *${displayName}* has been restricted ${durationText}.`,
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
      "❌ Failed to restrict the selected user.",
    );
    return false;
  }
}
