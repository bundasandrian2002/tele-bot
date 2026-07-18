import { EventConfig, EventExecute } from "@/types";
import "dotenv/config";
import getFBInfo from "@xaviabot/fb-downloader";
import axios from "axios";
import TelegramBot, { Message } from "node-telegram-bot-api";
import {
  getInnertube,
  getStreamWithFallback,
  safeFilename,
} from "@/utils/youtube";

export const config: EventConfig = {
  name: "autodl",
  description:
    "Auto-detects a pasted Facebook, TikTok, or YouTube video link anywhere in a message and downloads it — no command needed.",
  creator: "AjiroDesu",
  // Passive link-paste detector: unlike join/leave (bound to Telegram's
  // own dedicated event names) and unlike commands (gated behind an
  // explicit prefix), autodl watches every ordinary message body and
  // decides for itself — via its own regexes — whether a supported
  // Facebook/TikTok/YouTube video link is embedded anywhere in it.
  trigger: "message",
  // Prefixed messages are already routed to an explicit command by
  // handleCommands.ts (e.g. "/facebookdl <url>") — skip those here
  // so the same link doesn't get downloaded twice.
  skipCommandPrefix: true,
};

// ── Detection ────────────────────────────────────────────────────────────
// Each regex is deliberately scoped to URL shapes Meta/TikTok/YouTube only
// ever use for playable *video* content, so a pasted profile, group,
// photo-post, or carousel link is ignored instead of triggering a
// pointless download attempt. `.match()` (no /g flag) is used against the
// *whole* pasted text rather than requiring the message to be just a bare
// link, so a link embedded inside a copied post body/caption is still found.

// facebook.com/watch(/)?v=, page/videos/<id>, reel/<id>, share/v|r/<code>,
// video.php?v=, and fb.watch/<code> short links — every one of these is
// video-only. A plain facebook.com/<name> profile or photo.php link won't
// match any branch here.
const FB_VIDEO_RE =
  /(?:https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:watch\/?\?v=\d+|[\w.-]+\/videos\/\d+|reel\/\d+|share\/(?:v|r)\/[\w-]+|video\.php\?v=\d+)|https?:\/\/fb\.watch\/[\w-]+)/i;

// tiktok.com/@user/video/<id> and the m.tiktok.com /v/<id>.html form are
// unambiguously videos. vt./vm. short links are share-only subdomains (not
// used for TikTok's site navigation), so any shortcode there is accepted
// and then double-checked against tikwm's response below, since those
// short links can also resolve to TikTok's photo-carousel posts.
const TIKTOK_VIDEO_RE =
  /https?:\/\/(?:vt\.|vm\.)tiktok\.com\/[a-zA-Z0-9]{5,13}\/?|https?:\/\/(?:www\.|m\.)?tiktok\.com\/(?:@[\w.-]+\/video\/\d+|v\/\d+(?:\.html)?)/i;

// youtube.com/watch?v=, youtu.be/, youtube.com/shorts/ (Shorts), and
// youtube.com/embed/ — same pattern already used by ytmp4.ts/ytmp3.ts.
const YOUTUBE_VIDEO_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

// ── Facebook ─────────────────────────────────────────────────────────────
async function handleFacebook(api: TelegramBot, event: Message, url: string) {
  const result = await getFBInfo(url);

  // Non-video Facebook content (e.g. a photo post the regex still let
  // through) won't have sd/hd fields — stay quiet rather than error out,
  // since this fires passively on every paste, not on an explicit command.
  if (!result?.sd && !result?.hd) return;

  await api.setMessageReaction(event.chat.id, event.message_id, {
    reaction: [{ type: "emoji", emoji: "🔥" }],
  });

  await api.sendVideo(event.chat.id, result.hd || result.sd, {
    caption: "Downloaded Successfull(y).",
  });
}

// ── TikTok ───────────────────────────────────────────────────────────────
async function handleTikTok(api: TelegramBot, event: Message, url: string) {
  const response = await axios.post("https://www.tikwm.com/api/", { url });
  const data = response.data?.data;

  // tikwm returns an `images` array (no `play`) for photo-carousel
  // posts — those aren't videos, so skip them even if a short link
  // happened to resolve to one.
  if (!data?.play || data?.images?.length) return;

  await api.setMessageReaction(event.chat.id, event.message_id, {
    reaction: [{ type: "emoji", emoji: "🔥" }],
  });

  await api.sendVideo(event.chat.id, data.play, {
    caption: `@${data.author?.unique_id || "unknown"}`,
  });
}

// ── YouTube ──────────────────────────────────────────────────────────────
async function handleYouTube(
  api: TelegramBot,
  event: Message,
  videoId: string,
) {
  const yt = await getInnertube();
  const { info, stream } = await getStreamWithFallback(yt, videoId, "best");

  // Buffer the stream in memory instead of writing to disk (no fs/path),
  // same approach as ytmp4.ts.
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const videoBuffer = Buffer.concat(chunks);
  const safeTitle = safeFilename(info.basic_info.title, "video");

  await api.setMessageReaction(event.chat.id, event.message_id, {
    reaction: [{ type: "emoji", emoji: "🔥" }],
  });

  await api.sendVideo(
    event.chat.id,
    videoBuffer,
    {
      caption: `Downloaded Successfull(y). \n\n🎬 ${info.basic_info.title ?? safeTitle}`,
    },
    { filename: `${safeTitle}.mp4`, contentType: "video/mp4" },
  );
}

// ── Dispatch ─────────────────────────────────────────────────────────────
export async function execute({ api, event }: EventExecute) {
  const text = event.text?.trim();
  if (!text) return;

  try {
    const fbMatch = text.match(FB_VIDEO_RE);
    if (fbMatch) {
      return await handleFacebook(api, event, fbMatch[0]);
    }

    const ytMatch = text.match(YOUTUBE_VIDEO_RE);
    if (ytMatch) {
      return await handleYouTube(api, event, ytMatch[1]);
    }

    const ttMatch = text.match(TIKTOK_VIDEO_RE);
    if (ttMatch) {
      return await handleTikTok(api, event, ttMatch[0]);
    }
    // No supported link found — this is a normal, unrelated message,
    // so do nothing and stay silent.
  } catch (error) {
    console.error("autodl event error:", error);
  }
}
