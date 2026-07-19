import { EventConfig, EventExecute } from "@/types";
import {
  upsertUser,
  upsertGroup,
  upsertGroupMember,
  addXp,
  addBalance,
  getLevelReward,
  getUserRank,
} from "@/lib/db";
import { xpProgress } from "@/lib/leveling";
import { generateRankUpCard } from "@/lib/rankUpCard";
import { getAvatarUrl } from "@/lib/getAvatarUrl";

export const config: EventConfig = {
  name: "rankup",
  description:
    "Awards XP for group activity, keeps user/group/membership rows in sync, " +
    "and automatically announces + rewards a member with a rank-up card whenever their level goes up.",
  creator: "itsunknown",
  // Passive watcher, same shape as autokick/botname — every ordinary group
  // message is a chance to gain XP, so this binds to "message" rather than
  // a dedicated Telegram event.
  trigger: "message",
};

// XP awarded per eligible message, randomized so activity isn't perfectly
// predictable (same range popularized by MEE6-style leveling bots).
const XP_MIN = 15;
const XP_MAX = 25;
// Per-user, per-group cooldown between XP awards — stops someone from
// leveling up by spamming single-character messages.
const XP_COOLDOWN_MS = 60_000;
// Fallback coin reward when a level has no custom entry in level_rewards.
const DEFAULT_REWARD_PER_LEVEL = 50;

// `${userId}:${groupId}` -> last XP award timestamp (ms). In-memory and
// per-process, same tradeoff as autokick's spam tracker: resets on
// restart, which just means a handful of early messages get XP again.
const lastXpAt = new Map<string, number>();

export async function execute({ api, event }: EventExecute) {
  try {
    // Group-only: DMs have no "rank" concept, and channels have no `from`.
    if (event.chat.type !== "group" && event.chat.type !== "supergroup") return;

    const user = event.from;
    if (!user || user.is_bot) return;

    // Keep users/groups/membership current on every message — this is the
    // most reliable sync point, since a member can be active long before
    // (or without) ever triggering a dedicated join event.
    await upsertUser({
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      is_bot: user.is_bot,
      language_code: user.language_code,
    });
    await upsertGroup({
      id: event.chat.id,
      title: event.chat.title ?? "Unknown Group",
      type: event.chat.type,
      username: event.chat.username,
    });
    await upsertGroupMember(event.chat.id, user.id);

    const key = `${user.id}:${event.chat.id}`;
    const now = Date.now();
    const last = lastXpAt.get(key) ?? 0;
    if (now - last < XP_COOLDOWN_MS) return;
    lastXpAt.set(key, now);

    const amount = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
    const { leveledUp, newLevel, xp } = await addXp(user.id, event.chat.id, amount);
    if (!leveledUp) return;

    // Rank-up logic: look up a custom reward for this level, falling back
    // to a flat per-level default, then credit it through the ledger.
    const reward = await getLevelReward(newLevel);
    const rewardPoints = reward?.reward_points ?? newLevel * DEFAULT_REWARD_PER_LEVEL;
    if (rewardPoints > 0) {
      await addBalance(user.id, rewardPoints, "levelup_reward", {
        group_id: event.chat.id,
        level: newLevel,
      });
    }

    const [rank, avatarUrl] = await Promise.all([
      getUserRank(user.id, event.chat.id),
      getAvatarUrl(api, user.id),
    ]);

    const displayName = user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.first_name;

    // Progress within the new level, e.g. "1,240 / 5,100 XP".
    const { currentLevelXp, neededForNextLevel } = xpProgress(xp, newLevel);
    const xpText = `${currentLevelXp.toLocaleString()} / ${neededForNextLevel.toLocaleString()} XP`;

    const card = await generateRankUpCard({
      username: displayName,
      avatarUrl,
      level: newLevel,
      xpText,
      rank,
    });

    // Rank-up response: the card carries the level transition, so the
    // caption stays short — just the mention and the coin reward.
    // Kept outside the *bold* span, same reasoning as join.ts — the
    // sanitizer's span parser doesn't handle a [text](url) link nested
    // inside *bold*.
    const mention = `[${displayName}](tg://user?id=${user.id})`;
    const rewardLine = rewardPoints > 0 ? ` Earned *${rewardPoints}* point's.` : "";
    const customMessage = reward?.message ? `\n\n${reward.message}` : "";

    await api.sendPhoto(
      event.chat.id,
      card,
      {
        caption: `🎉 Congratulations ${mention} just reached *Level ${newLevel}*!${rewardLine}${customMessage}`,
      },
      { filename: "rankup.png", contentType: "image/png" },
    );
  } catch (error) {
    console.error("rankup event error:", error);
  }
}
