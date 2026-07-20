import { AgentContext, AgentTool } from "@/types";
import { getUserLevel, getUserRank, getBalance } from "@/lib/db";
import { xpProgress } from "@/lib/leveling";

export const config: AgentTool["config"] = {
  name: "rankup",
  description:
    "Look up a user's live level, XP progress, group leaderboard rank, and $ balance — " +
    "the same data the rankup event tracks and cards off of. Use this whenever the user asks " +
    "about their (or someone else's) level, rank, XP, or $ balance; prefer it over the 'User profile' " +
    "line in your system prompt, which is only a snapshot taken at the start of the turn and can " +
    "be stale. Defaults to whoever is chatting with you, or whoever they replied to — pass " +
    "target_user_id to check a specific person instead (e.g. from an @mention).",
  parameters: {
    type: "object",
    properties: {
      target_user_id: {
        type: "number",
        description:
          "Telegram user id to look up. Omit to default to the replied-to user if this message " +
          "is a reply, otherwise the current user.",
      },
    },
    required: [],
  },
};

export const run: AgentTool["run"] = async (
  { target_user_id }: { target_user_id?: number },
  ctx: AgentContext,
) => {
  const repliedTo = ctx.event.reply_to_message?.from;
  const userId = target_user_id ?? repliedTo?.id ?? ctx.event.from?.id;
  if (!userId) return "Error: No user to look up.";

  const lines: string[] = [`User id ${userId}:`];

  try {
    const balance = await getBalance(userId);
    lines.push(`- $: ${balance.toLocaleString()}`);
  } catch (err) {
    lines.push(
      `- $: unavailable (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const isGroup =
    ctx.event.chat.type === "group" || ctx.event.chat.type === "supergroup";

  if (!isGroup) {
    lines.push("- Level/XP/rank: only tracked in group chats, not here.");
    return lines.join("\n");
  }

  try {
    const [{ level, xp }, rank] = await Promise.all([
      getUserLevel(userId, ctx.event.chat.id),
      getUserRank(userId, ctx.event.chat.id),
    ]);

    if (level === 0 && xp === 0) {
      lines.push("- Level: no activity/XP recorded in this group yet.");
    } else {
      const { currentLevelXp, neededForNextLevel } = xpProgress(xp, level);
      lines.push(
        `- Level: ${level} (${currentLevelXp.toLocaleString()} / ${neededForNextLevel.toLocaleString()} XP to next level, ${xp.toLocaleString()} lifetime XP)`,
      );
      lines.push(rank ? `- Rank: #${rank} in this group` : "- Rank: unranked");
    }
  } catch (err) {
    lines.push(
      `- Level/rank: unavailable (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  return lines.join("\n");
};
