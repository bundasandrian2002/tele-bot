import { Config, Execute } from "@/types";
import "dotenv/config";
import Shoti from "showty";

export const config: Config = {
  name: "ishoti",
  description: "Generate a random image from TikTok.",
  usage: "/ishoti",
  permission: "user",
  creator: "libyzxy0",
};

if (!process.env.SHOTI_APIKEY) {
  console.error(
    "[ishoti] SHOTI_APIKEY is not set — the /ishoti command will fail until it's added to your environment variables.",
  );
}

const shoti = new Shoti(process.env.SHOTI_APIKEY);

export async function execute({ api, event }: Execute) {
  try {
    const result = await shoti.getShoti({ type: "image" });

    // getShoti() can resolve to `{ error, code }` instead of throwing
    // on failure — accessing `.user`/`.content` on that shape used to
    // crash with a confusing "Cannot read properties of undefined"
    // instead of surfacing the actual API error.
    if ("error" in result) {
      throw new Error(result.error);
    }

    const { user, content } = result;
    const media = (Array.isArray(content) ? content : [content]).map((url) => ({
      type: "photo" as const,
      media: url,
      caption: `@${user.username}`,
    }));
    await api.sendMediaGroup(event.chat.id, media);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    api.sendMessage(event.chat.id, "Error: " + message);
    return false;
  }
}
