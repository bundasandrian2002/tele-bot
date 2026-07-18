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
 * and builds a short profile string the AI gets told about — level, XP
 * rank, and coin balance when available. Returns undefined (rather than an
 * empty-context string) on any DB hiccup, so a database outage degrades to
 * "the AI just doesn't have profile context this turn" instead of failing
 * the whole command.
 */
async function buildUserContext(event: Execute["event"]): Promise<string | undefined> {
  const user = event.from;
  if (!user) return undefined;

  try {
    await upsertUser({
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      is_bot: user.is_bot,
      language_code: user.language_code,
    });

    const parts: string[] = [
      user.username ? `@${user.username}` : user.first_name,
      `Telegram id ${user.id}`,
    ];

    const isGroup = event.chat.type === "group" || event.chat.type === "supergroup";
    if (isGroup) {
      const [{ level, xp }, rank] = await Promise.all([
        getUserLevel(user.id, event.chat.id),
        getUserRank(user.id, event.chat.id),
      ]);
      parts.push(
        level > 0
          ? `level ${level} in this group (${xp.toLocaleString()} XP${rank ? `, rank #${rank}` : ""})`
          : "no activity/XP recorded in this group yet",
      );
    }

    const balance = await getBalance(user.id);
    parts.push(`${balance.toLocaleString()} coins`);

    return parts.join(", ");
  } catch (error) {
    console.error("ai command: failed to build user context:", error);
    return undefined;
  }
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
