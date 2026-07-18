import { Config, Execute } from "@/types";

export const config: Config = {
  name: "uptime",
  description: "Show how long the bot has been running and current ping latency.",
  usage: "/uptime",
  permission: "user",
  creator: "libyzxy0",
};

/** Formats a duration in seconds as "Xd Xh Xm Xs", dropping leading zero units. */
function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export async function execute({ api, event }: Execute) {
  // Ping is measured as an actual Telegram API round-trip, not a fixed/fake
  // number: send a placeholder message, time how long the API call took to
  // resolve (request out + response back), then edit that same message in
  // with the real uptime + measured latency. This reflects real network/API
  // conditions at the moment the command runs, rather than a static value.
  const start = Date.now();

  const sentMessage = await api.sendMessage(event.chat.id, "🏓 Pinging...");

  const latencyMs = Date.now() - start;
  const uptimeText = formatUptime(process.uptime());

  // Markdown is left unescaped here on purpose — the bot's wrapper
  // (utils/wrapper.ts) runs every editMessageText call through
  // sanitizeMarkdownV2 automatically, so manual escaping would just be
  // redundant/risk double-escaping.
  await api.editMessageText(
    `🏓 *Pong!*\n\n` +
      `⏱ *Uptime:* ${uptimeText}\n` +
      `📶 *Ping:* ${latencyMs}ms`,
    {
      chat_id: event.chat.id,
      message_id: sentMessage.message_id,
    },
  );
}
