import type TelegramBot from "node-telegram-bot-api";

/**
 * Resolves a user's current Telegram profile photo to a fetchable URL, or
 * null if they have none set (or it can't be resolved) — the greet card
 * falls back to its generated emblem in that case.
 */
export async function getAvatarUrl(api: TelegramBot, userId: number): Promise<string | null> {
  try {
    const photos = await api.getUserProfilePhotos(userId, { limit: 1 });
    const sizes = photos.photos?.[0];
    if (!sizes?.length) return null;
    // Telegram returns each photo as several resolutions, largest last.
    const fileId = sizes[sizes.length - 1].file_id;
    return await api.getFileLink(fileId);
  } catch {
    return null;
  }
}
