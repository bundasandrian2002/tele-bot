import { Innertube, UniversalCache, YTNodes } from "youtubei.js";

// youtubei.js doesn't re-export its `InnerTubeClient` type from the
// package root, so it's derived here from the actual method signature
// instead of hardcoding a second copy of the client-name union.
type InnerTubeClient = NonNullable<
  Parameters<Innertube["getBasicInfo"]>[1]
>["client"];

// Matches youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, youtube.com/embed/
export const YOUTUBE_URL_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

// YouTube has been rotating which innertube client is allowed to fetch
// streaming data without a signed-in session. WEB/ANDROID throw
// "Login required" for many videos, while TV_EMBEDDED throws
// "Video unavailable" for videos that disallow embedding. Try a few
// clients in order and use whichever one actually works for this video.
export const CLIENT_FALLBACKS: InnerTubeClient[] = [
  "TV_EMBEDDED",
  "WEB",
  "ANDROID",
  "IOS",
];

let cachedClient: Innertube | null = null;

// Creating an Innertube client does a session-bootstrap network round
// trip. Commands were creating a brand-new one on every single
// invocation; reusing one instance across calls avoids that repeated
// startup cost.
export async function getInnertube(): Promise<Innertube> {
  if (!cachedClient) {
    cachedClient = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
    });
  }
  return cachedClient;
}

/**
 * Resolves a search query, raw video ID, or YouTube URL to a video ID.
 * `args` may arrive as an array of words or as a single already-joined
 * string depending on the caller, so normalize before using .join().
 */
export async function resolveVideoId(
  yt: Innertube,
  args: string[] | string,
): Promise<string | null> {
  const argsArray = Array.isArray(args) ? args : String(args ?? "").split(" ");
  const query = argsArray.join(" ").trim();

  if (!query) return null;

  // If the user passed a real YouTube URL/ID directly, use it as-is
  // instead of searching for it.
  const urlMatch = query.match(YOUTUBE_URL_RE);
  if (urlMatch) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(query)) {
    return query;
  }

  const search = await yt.search(query, { type: "video" });
  const results = search.results?.as(YTNodes.Video);

  return results?.[0]?.video_id ?? null;
}

/**
 * Some clients succeed at getBasicInfo but still throw "Video unavailable"
 * when the actual stream/download is requested (info and streaming
 * availability are checked separately per client by YouTube). So retry the
 * full info+download pair per client, not just info.
 *
 * NOTE: getBasicInfo/download both take an *options object* (e.g.
 * `{ client: "TV_EMBEDDED" }`), not a bare client string as a second
 * positional argument — passing the raw string silently does nothing
 * (the client always falls back to the default), which is why every
 * caller of this used to always hit the exact same "Login required" /
 * "Video unavailable" errors regardless of the fallback list.
 */
export async function getStreamWithFallback(
  yt: Innertube,
  videoId: string,
  quality: string = "best",
) {
  let lastErr: unknown;
  for (const client of CLIENT_FALLBACKS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const stream = await yt.download(videoId, {
        type: "video+audio",
        quality,
        format: "mp4",
        client,
      });
      return { info, stream, client };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// info.basic_info.thumbnail URLs can be WebP or have per-client
// restrictions that cause silent fetch failures for some videos.
// i.ytimg.com standard JPEG URLs are always public — try from highest
// quality down until one returns a successful HTTP response.
const THUMB_QUALITIES = [
  "maxresdefault",
  "hqdefault",
  "mqdefault",
  "sddefault",
];

export async function fetchBestThumbnail(
  videoId: string,
): Promise<Buffer | undefined> {
  for (const quality of THUMB_QUALITIES) {
    try {
      const res = await fetch(
        `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`,
      );
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch {
      // try next quality
    }
  }
  return undefined;
}

export function safeFilename(
  title: string | undefined,
  fallback: string,
): string {
  return (
    (title ?? fallback)
      .replace(/[\\/:*?"<>|]+/g, "")
      .trim()
      .slice(0, 200) || fallback
  );
}
