import { Config, Execute } from "@/types";

export const config: Config = {
  name: "id",
  description: "Get your id.",
  usage: "/id",
  permission: "user",
  creator: "libyzxy0",
};

export async function execute({ api, event }: Execute) {
  if (!event.from) return;

  api.sendMessage(event.chat.id, `Your ID: ${event.from.id}`);
}
