import { Config, Execute } from "@/types";
import "dotenv/config";
import axios from "axios";

export const config: Config = {
  name: "shotiv0",
  description: "Generate a random video from TikTok.",
  usage: "/shotiv0",
  permission: "user",
  creator: "itsunknown",
};

interface ShotiV0Response {
  shotiurl?: string;
  username?: string;
}

export async function execute({ api, event }: Execute) {
  try {
    const { data } = await axios.get<ShotiV0Response>(
      "https://betadash-shoti-yazky.vercel.app/shotizxx?apikey=shipazu",
    );

    if (!data.shotiurl) {
      throw new Error("No shoti video found.");
    }

    await api.sendVideo(event.chat.id, data.shotiurl, {
      caption: data.username ? `@${data.username}` : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.sendMessage(event.chat.id, "❌ Error: " + message);
    return false;
  }
}
