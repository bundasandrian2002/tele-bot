import { Config, Execute } from "@/types";
import { upsertUser, getLastDailyClaimAt, addBalance } from "@/lib/db";

export const config: Config = {
  name: "daily",
  description: "Claim your daily point reward. Resets 24 hours after your last claim.",
  usage: "/daily",
  permission: "user",
  creator: "itsunknown",
};

// Randomized like rankup.ts's XP award, so the payout isn't perfectly
// predictable while still averaging out to something consistent.
const DAILY_MIN = 100;
const DAILY_MAX = 250;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** "3h 12m" style countdown for how long until the next claim. */
function formatRemaining(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export async function execute({ api, event }: Execute) {
  const user = event.from;
  if (!user) return false;

  // Registers the user if this is the very first thing they've ever run
  // (e.g. a fresh DM, never active in a group) — user_wallets/wallet_
  // transactions both have a foreign key on users(id), so addBalance
  // below would otherwise fail for a genuinely new user.
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
    console.error("daily command: failed to upsert user:", error);
  }

  try {
    const lastClaim = await getLastDailyClaimAt(user.id);
    if (lastClaim) {
      const elapsed = Date.now() - lastClaim.getTime();
      if (elapsed < COOLDOWN_MS) {
        const remaining = formatRemaining(COOLDOWN_MS - elapsed);
        await api.sendMessage(
          event.chat.id,
          `⏳ *Already Claimed!*\n\nYou can claim your next daily reward in *${remaining}*.`,
        );
        return false;
      }
    }

    const amount = Math.floor(Math.random() * (DAILY_MAX - DAILY_MIN + 1)) + DAILY_MIN;
    const balanceAfter = await addBalance(user.id, amount, "daily");

    await api.sendMessage(
      event.chat.id,
      `🎁 *Daily Reward Claimed!*\n\n` +
        `+*${amount.toLocaleString()}* points\n` +
        `💰 Balance: *${balanceAfter.toLocaleString()}* points\n\n` +
        `Come back in 24 hours for more.`,
    );
  } catch (error) {
    console.error("Error executing 'daily':", error);
    await api.sendMessage(event.chat.id, "❌ Failed to claim your daily reward.");
    return false;
  }
}
