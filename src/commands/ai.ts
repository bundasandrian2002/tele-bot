import { Config, Execute } from "@/types";
import { runAgent } from "@/utils/agent";
import { upsertUser, getUserLevel, getUserRank, getBalance } from "@/lib/db";

export const config: Config = {
  name: "ai",
  description:
    "Chat with the AI assistant — it can also run this bot's other commands on your behalf.",
  usage: "/ai [prompt]",
  permission: "user",
  creator: "AjiroDesu",
};

/**
 * Registers/refreshes this user in the database (so /ai alone is enough to
 * be "known", even for someone who never triggers rankup.ts by chatting)
 * and builds a short profile string the AI gets told about — name/id
 * always, plus level, XP rank, and coin balance when available. Only
 * returns undefined when there's no Telegram user on the event at all;
 * each DB lookup (upsert, level/rank, balance) fails independently so a
 * single outage just omits that one detail instead of losing the user's
 * identity too.
 */
async function buildUserContext(event: Execute["event"]): Promise<string | undefined> {
  const user = event.from;
  if (!user) return undefined;

  // Identity always comes from the Telegram update itself, never the DB, so
  // the AI recognizes *someone* even when every DB call below fails —
  // "who is this user" and "what do we know about them" are treated as two
  // separate, independently-failable concerns.
  const parts: string[] = [
    user.username ? `@${user.username}` : user.first_name,
    `Telegram id ${user.id}`,
  ];

  try {
    await upsertUser({
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      is_bot: user.is_bot,
      language_code: user.language_code,
    });
  } catch (error) {
    console.error("ai command: failed to upsert user:", error);
  }

  const isGroup = event.chat.type === "group" || event.chat.type === "supergroup";
  if (isGroup) {
    try {
      const [{ level, xp }, rank] = await Promise.all([
        getUserLevel(user.id, event.chat.id),
        getUserRank(user.id, event.chat.id),
      ]);
      parts.push(
        level > 0
          ? `level ${level} in this group (${xp.toLocaleString()} XP${rank ? `, rank #${rank}` : ""})`
          : "no activity/XP recorded in this group yet",
      );
    } catch (error) {
      console.error("ai command: failed to fetch level/rank:", error);
    }
  }

  try {
    const balance = await getBalance(user.id);
    parts.push(`${balance.toLocaleString()} coins`);
  } catch (error) {
    console.error("ai command: failed to fetch balance:", error);
  }

  // Always at least "@handle, Telegram id N" — never undefined once we know
  // who the user is, so the model is never left with zero recognition of
  // them just because one DB lookup failed.
  return parts.join(", ");
}

export async function execute({ api, event, args, chatbotConfig }: Execute) {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    await api.sendMessage(event.chat.id, `Usage: ${config.usage}`);
    return false;
  }

  try {
    const userContext = await buildUserContext(event);

    // runAgent keeps the "typing…" indicator refreshed for its whole turn,
    // so no one-off sendChatAction is needed here.
    const result = await runAgent(prompt, api, event, chatbotConfig, userContext);
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
