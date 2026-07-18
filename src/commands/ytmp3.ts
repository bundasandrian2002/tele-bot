import { Config, Execute } from "@/types";
import {
  getInnertube,
  resolveVideoId,
  getStreamWithFallback,
  fetchBestThumbnail,
  safeFilename,
} from "@/utils/youtube";

export const config: Config = {
  name: "ytmp3",
  description: "Search and download music/audio from YouTube.",
  usage: "/ytmp3 [title | url]",
  permission: "user",
  creator: "itsunknown",
};

export async function execute({ api, event, args }: Execute) {
  try {
    if (!args.length) {
      await api.sendMessage(event.chat.id, "⚠️ Input a music title...");
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

    const audioBuffer = Buffer.concat(chunks);
    const duration = (Date.now() - start) / 1000;
    const speed = bytesDownloaded / duration / (1024 * 1024);
    const sizeMB = bytesDownloaded / (1024 * 1024);

    // Telegram/bot-api libraries name the upload from a `filename` option,
    // not from the video's title automatically — without it, a bare Buffer
    // gets a generic default name like "data.mp4". Derive it from the
    // video's actual title instead, stripped of characters that break
    // filenames.
    const safeTitle = safeFilename(info.basic_info.title, "audio");
    const filename = `${safeTitle}.mp3`;

    const thumbnailBuffer = await fetchBestThumbnail(videoId);

    const caption =
      `📽️ Downloaded Successfull(y).\n\n` +
      `🎬 Title: ${info.basic_info.title}\n` +
      `📦 Size: ${sizeMB.toFixed(2)} MB\n` +
      `⚡ Speed: ${speed.toFixed(2)} MB/s\n` +
      `⏱️ Duration: ${duration.toFixed(2)} seconds`;

    await api.sendAudio(
      event.chat.id,
      audioBuffer,
      {
        caption,
        performer: info.basic_info.author ?? "",
        title: info.basic_info.title ?? safeTitle,
        ...(thumbnailBuffer && { thumbnail: thumbnailBuffer }),
      },
      { filename, contentType: "audio/mpeg" },
    );
  } catch (err) {
    console.error("YouTube audio download error:", err);
    const message = err instanceof Error ? err.message : String(err);
    api.sendMessage(event.chat.id, `❌ Error: ${message}`);
    return false;
  }
}
