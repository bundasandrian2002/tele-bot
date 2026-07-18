import TelegramBot, { Message, User } from "node-telegram-bot-api";

/**
 * Resolves which user a moderation command (kick, restrict, etc.) should
 * act on, following the "mention or reply" convention shared by those
 * commands:
 *   1. Replying to someone's message and running the command targets
 *      whoever sent that message.
 *   2. Otherwise, an @mention in the command text is used instead.
 *
 * A plain "@username" mention doesn't carry a user id in the message
 * itself — Telegram only attaches one directly for "text_mention"
 * entities (used when a client mentions someone who has no username).
 * For an ordinary "mention" entity this falls back to api.getChat(),
 * which only resolves if that user has a public username; if it can't
 * be resolved, this returns null so the caller can ask for a reply
 * instead.
 */
export async function resolveTargetUser(
  api: TelegramBot,
  message: Message,
): Promise<User | null> {
  if (message.reply_to_message?.from) {
    return message.reply_to_message.from;
  }

  const entities = message.entities ?? [];

  const textMention = entities.find(
    (entity) => entity.type === "text_mention" && entity.user,
  );
  if (textMention?.user) {
    return textMention.user;
  }

  const mention = entities.find((entity) => entity.type === "mention");
  if (mention && message.text) {
    const username = message.text.substring(
      mention.offset,
      mention.offset + mention.length,
    );

    try {
      const chat = await api.getChat(username);
      if (chat.type !== "private") return null;

      return {
        id: chat.id,
        is_bot: false,
        first_name: chat.first_name ?? username,
        last_name: chat.last_name,
        username: chat.username,
      };
    } catch {
      // getChat only resolves usernames Telegram has seen interact
      // with this bot/chat before — an unresolvable mention just
      // means "couldn't find that user", not a real error.
      return null;
    }
  }

  return null;
}
