import { Config, Execute } from "@/types";
import axios from "axios";

export const config: Config = {
  name: "vitamin",
  description: "Generate a random cosplay from the archive.",
  usage: "/vitamin",
  permission: "user",
  creator: "itsunknown",
};

const REPO_URL = "https://github.com/ajirodesu/cosplay/tree/main/";

// GitHub's repo-tree page now embeds the file listing as JSON inside the
// page payload (`"tree":{"items":[{"name":"x.mp4","path":"x.mp4",...}]}`)
// rather than as plain `<a href="...">` anchor tags, so that's matched
// first. The old anchor-tag pattern is kept as a fallback in case GitHub
// ever serves the older markup again for a particular request.
const JSON_ITEM_RE = /"name":"[^"]+\.mp4","path":"([^"]+)"/g;
const ANCHOR_HREF_RE = /href="\/ajirodesu\/cosplay\/blob\/main\/([^"]+\.mp4)"/g;

/**
 * Scrapes the ajirodesu/cosplay GitHub tree for .mp4 file paths and returns
 * a raw.githubusercontent.com URL for a randomly selected video.
 * Throws on any error so the caller can surface a clean error message.
 *
 * NOTE: GitHub serves a stripped-down HTML response (no file-tree data at
 * all) to requests that don't look like they came from a browser. axios'
 * default User-Agent is "axios/<version>", which GitHub treats that way,
 * so every request here used to come back with zero matches. Sending an
 * explicit browser-like User-Agent fixes that.
 */
async function fetchCosplayVideo(): Promise<string> {
  const { data: html } = await axios.get<string>(REPO_URL, {
    timeout: 8000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });

  const files = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = JSON_ITEM_RE.exec(html)) !== null) {
    if (match[1]) files.add(match[1]);
  }
  if (!files.size) {
    while ((match = ANCHOR_HREF_RE.exec(html)) !== null) {
      if (match[1]) files.add(match[1]);
    }
  }

  if (!files.size) {
    throw new Error("No videos found.");
  }

  const fileList = Array.from(files);
  const file = fileList[Math.floor(Math.random() * fileList.length)];
  return `https://raw.githubusercontent.com/ajirodesu/cosplay/main/${file}`;
}

export async function execute({ api, event }: Execute) {
  try {
    const videoUrl = await fetchCosplayVideo();

    await api.sendVideo(event.chat.id, videoUrl, {
      caption: "Downloaded Successfull(y).",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    api.sendMessage(event.chat.id, "❌ Error: " + message);
    return false;
  }
}
