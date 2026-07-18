import { Config, Execute } from "@/types";
import "dotenv/config";
import getFBInfo from "@xaviabot/fb-downloader";

export const config: Config = {
  name: "facebookdl",
  description: "Download a video from Facebook.",
  usage: "/facebookdl [url]",
  permission: "user",
  creator: "itsunknown",
};

// NOTE: no `g` flag here. A global regex used with `.test()` keeps its
// `lastIndex` between calls, so a module-level `RegExp` with `/g` used
// with `.test()` on every command invocation would alternate between
// true/false results for the exact same input across consecutive runs.
const FB_URL_RE = /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i;

export async function execute({ api, event, args }: Execute) {
  const body = args[0];

  if (!body || !FB_URL_RE.test(body)) {
    await api.sendMessage(event.chat.id, "❌ No valid Facebook URL found.");
    return false;
  }

  try {
    const url = body.match(FB_URL_RE)?.[0];
    if (!url) {
      await api.sendMessage(event.chat.id, "❌ No valid Facebook URL found.");
      return false;
    }

    const result = await getFBInfo(url);

    if (!result?.sd && !result?.hd) {
      await api.sendMessage(event.chat.id, "❌ Unable to retrieve the video.");
      return false;
    }

    await api.sendVideo(event.chat.id, result.hd || result.sd, {
      caption: "Downloaded Successfull(y).",
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    await api.sendMessage(event.chat.id, `❌ Error: ${message}`);
    return false;
  }
}
