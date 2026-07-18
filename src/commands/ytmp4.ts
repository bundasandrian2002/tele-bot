import { Config, Execute } from "@/types";
import {
  getInnertube,
  resolveVideoId,
  getStreamWithFallback,
  fetchBestThumbnail,
  safeFilename,
} from "@/utils/youtube";

export const config: Config = {
  name: "ytmp4",
  description: "Search and download a video from YouTube.",
  usage: "/ytmp4 [title | url]",
  permission: "user",
  creator: "itsunknown"
};

export async function execute({ api, event, args }: Execute) {
  try {
    if (!args.length) {
      await api.sendMessage(event.chat.id, "⚠️ Input a video title...");
      return false;
    }

    const yt = await getInnertube();

    const videoId = await resolveVideoId(yt, args);
    if (!videoId) {
      await api.sendMessage(event.chat.id, "⚠️ Video not found.");
      return false;
    }

    const { info, stream } = await getStreamWithFallback(
      yt,
      videoId,
      "bestefficiency",
    );

    // Buffer the stream in memory instead of writing to disk (no fs/path).
    const start = Date.now();
    let bytesDownloaded = 0;
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
      bytesDownloaded += chunk.length;
    }

    const videoBuffer = Buffer.concat(chunks);
    const duration = (Date.now() - start) / 1000;
    const speed = bytesDownloaded / duration / (1024 * 1024);
    const sizeMB = bytesDownloaded / (1024 * 1024);

    // Telegram/bot-api libraries name the upload from a `filename` option,
    // not from the video's title automatically — without it, a bare Buffer
    // gets a generic default name like "data.mp4". Derive it from the
    // video's actual title instead, stripped of characters that break
    // filenames. (This was previously hardcoded to a ".mp3" extension
    // here even though this command downloads video — fixed below.)
    const safeTitle = safeFilename(info.basic_info.title, "video");
    const filename = `${safeTitle}.mp4`;

    const thumbnailBuffer = await fetchBestThumbnail(videoId);

    const caption =
      `📽️ Downloaded Successfull(y).\n\n` +
      `🎬 Title: ${info.basic_info.title}\n` +
      `📦 Size: ${sizeMB.toFixed(2)} MB\n` +
      `⚡ Speed: ${speed.toFixed(2)} MB/s\n` +
      `⏱️ Duration: ${duration.toFixed(2)} seconds`;

    await api.sendVideo(
      event.chat.id,
      videoBuffer,
      {
        caption,
        ...(thumbnailBuffer && { thumbnail: thumbnailBuffer }),
      },
      { filename, contentType: "video/mp4" },
    );
  } catch (err) {
    console.error("YouTube video download error:", err);
    const message = err instanceof Error ? err.message : String(err);
    api.sendMessage(event.chat.id, `❌ Error: ${message}`);
    return false;
  }
}
