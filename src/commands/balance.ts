import { Config, Execute } from "@/types";
import { getBalance } from "@/lib/db";
import { resolveTargetUser } from "@/utils/resolveTargetUser";

export const config: Config = {
  name: "balance",
  description:
    "Check your point balance, or someone else's by replying to their message or @mentioning them.",
  usage: "/balance OR /balance (reply to a user) OR /balance @username",
  permission: "user",
  creator: "itsunknown",
};

export async function execute({ api, event, chatbotConfig }: Execute) {
  if (!event.from) return false;

  // Unlike restrict.ts/kick.ts, no reply/mention isn't an error here — it
  // just means "check my own balance", which is the common case.
  const target = (await resolveTargetUser(api, event)) ?? event.from;
  const isSelf = target.id === event.from.id;
  const displayName = target.last_name
    ? `${target.first_name} ${target.last_name}`
    : target.first_name;

  // Bot admins (chatbotConfig.admins) always read as unlimited — the
  // underlying user_wallets row is untouched (BIGINT can't hold Infinity
  // anyway, and nothing currently spends points), this is purely what
  // /balance reports for them.
  if (chatbotConfig.admins.includes(target.id)) {
    await api.sendMessage(
      event.chat.id,
      isSelf
        ? `💰 *Your Balance:* ♾️ (unlimited — admin)`
        : `💰 *${displayName}'s Balance:* ♾️ (unlimited — admin)`,
    );
    return;
  }

  try {
    const balance = await getBalance(target.id);

    await api.sendMessage(
      event.chat.id,
      isSelf
        ? `💰 *Your Balance:* ${balance.toLocaleString()} points`
        : `💰 *${displayName}'s Balance:* ${balance.toLocaleString()} points`,
    );
  } catch (error) {
    console.error("Error executing 'balance':", error);
    await api.sendMessage(event.chat.id, "❌ Failed to fetch balance.");
    return false;
  }
}
