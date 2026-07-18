/**
 * Mirrors the XP curve implemented by level_for_xp()/add_xp() in
 * sql/migrations/0001_init.sql. The database is the source of truth for
 * awarding XP (see db.ts's addXp) — this is only for display purposes,
 * e.g. showing "X / Y XP to next level" without an extra round trip.
 */

/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return 5 * level ** 2 + 50 * level + 100;
}

/** Progress within the user's current level, given their total lifetime XP. */
export function xpProgress(totalXp: number, level: number) {
  let remaining = totalXp;
  for (let l = 0; l < level; l++) {
    remaining -= xpForLevel(l);
  }
  const needed = xpForLevel(level);
  return { currentLevelXp: remaining, neededForNextLevel: needed };
}
