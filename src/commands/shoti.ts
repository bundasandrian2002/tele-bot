import { Config, Execute } from "@/types";
import "dotenv/config";
import Shoti from "showty";

export const config: Config = {
  name: "shoti",
  description: "Generate a random video from TikTok.",
  usage: "/shoti",
  permission: "user",
  creator: "libyzxy0",
};

if (!process.env.SHOTI_APIKEY) {
  console.error(
    "[shoti] SHOTI_APIKEY is not set — the /shoti command will fail until it's added to your environment variables.",
  );
}

const shoti = new Shoti(process.env.SHOTI_APIKEY);

export async function execute({ api, event }: Execute) {
  try {
    const result = await shoti.getShoti({ type: "video" });

    // getShoti() can resolve to `{ error, code }` instead of throwing
    // on failure — accessing `.user`/`.content` on that shape used to
    // crash with a confusing "Cannot read properties of undefined"
    // instead of surfacing the actual API error.
    if ("error" in result) {
      throw new Error(result.error);
    }

    const { user, content } = result;
    const videoUrl = Array.isArray(content) ? content[0] : content;

    await api.sendVideo(event.chat.id, videoUrl, {
      caption: `@${user.username}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.sendMessage(event.chat.id, "❌ Error: " + message);
    return false;
  }
}
