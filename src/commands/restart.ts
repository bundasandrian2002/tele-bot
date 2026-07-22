import { Config, Execute } from "@/types";
import { setBotSetting } from "@/lib/db";

export const config: Config = {
  name: "restart",
  description:
    "Restarts the bot process and confirms success once it's back online. Requires the host (Docker, PM2, systemd, Railway, etc.) to auto-restart on exit — this command only asks the process to stop.",
  usage: "/restart",
  permission: "admin",
  creator: "itsunknown",
};

export async function execute({ api, event }: Execute) {
  const sentMessage = await api.sendMessage(event.chat.id, "🔄 Restarting...");

  // Recorded so the *next* process — which has no memory of this one —
  // knows where to send the "back online" confirmation. Read once and
  // cleared on startup in src/index.ts; storing message_id lets it edit
  // this same "Restarting..." message into the confirmation instead of
  // sending a second one.
  await setBotSetting(
    "pending_restart",
    JSON.stringify({ chatId: event.chat.id, messageId: sentMessage.message_id }),
  );

  // Exiting is the only part this command controls — whatever actually
  // brings the process back up (Docker/PM2/systemd restart policy, the
  // hosting platform, etc.) lives outside this codebase. Without one of
  // those in place, this just stops the bot and the confirmation above
  // will never be read.
  //
  // Delayed slightly so the "Restarting..." message and its 🔥 reaction
  // (added by runCommand in utils/handleCommands.ts right after this
  // resolves) have time to actually reach Telegram before the process
  // dies mid-request.
  setTimeout(() => process.exit(0), 500);
}
