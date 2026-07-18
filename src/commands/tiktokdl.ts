import { Config, Execute } from "@/types";
import "dotenv/config";
import axios from "axios";

export const config: Config = {
  name: "tiktokdl",
  description: "Download a video from TikTok.",
  usage: "/tiktokdl [url]",
  permission: "user",
  creator: "libyzxy0",
};

// NOTE: no `g` flag here. A global regex used with `.test()` keeps its
// `lastIndex` between calls, so a module-level `RegExp` with `/g` used
// with `.test()` on every command invocation would alternate between
// true/false results for the exact same input across consecutive runs.
const TIKTOK_URL_RE = /https:\/\/(www\.|vt\.)?tiktok\.com\/([\w\W]{9})/i;

export async function execute({ api, event, args }: Execute) {
  const body = args[0];

  if (!body || !TIKTOK_URL_RE.test(body)) {
    await api.sendMessage(
      event.chat.id,
      `❌ No valid TikTok URL found. ${body ?? ""}`,
    );
    return false;
  }

  try {
    const match = body.match(TIKTOK_URL_RE);
    const link = match ? match[0] : null;

    const response = await axios.post("https://www.tikwm.com/api/", {
      url: link,
    });

    const data = response.data?.data;

    if (!data?.play) {
      throw new Error("Failed to fetch TikTok video.");
    }

    await api.sendVideo(event.chat.id, data.play, {
      caption: `@${data.author?.unique_id || "unknown"}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.sendMessage(event.chat.id, "❌ Error: " + message);
    return false;
  }
}
