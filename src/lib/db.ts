/**
 * Database access layer for the bot's NeonDB (Postgres) database.
 *
 * Uses `pg` rather than `@neondatabase/serverless`'s HTTP driver on purpose:
 * this bot is a long-running polling process (not a serverless function),
 * so a normal pooled TCP connection is simpler and cheaper than paying an
 * HTTP round trip per query, and it lets add_xp()'s row lock (see
 * sql/migrations/0001_init.sql) behave exactly like it would with any other
 * Postgres client.
 */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Please specify DATABASE_URL in your environment variables.");
}

export const pool = new Pool({
  connectionString,
  // SSL is driven entirely by `?sslmode=require` in DATABASE_URL (see
  // .env.example) rather than an explicit `ssl` option here — passing
  // both at once is ambiguous to `pg` (which config wins?) and triggers
  // its "If you want the current behavior, explicitly use
  // sslmode=verify-full" warning. One source of truth avoids that.
  max: 10,
});

pool.on("error", (err) => {
  // A pooled idle client erroring out (e.g. Neon recycling a stale
  // connection) shouldn't crash the whole bot process.
  console.error("Unexpected database pool error:", err);
});

// ---------------------------------------------------------------------------
// users / groups / group_members
// ---------------------------------------------------------------------------

export type UpsertUserInput = {
  id: number;
  username?: string | null;
  first_name: string;
  last_name?: string | null;
  is_bot?: boolean;
  language_code?: string | null;
};

export async function upsertUser(user: UpsertUserInput) {
  await pool.query(
    `INSERT INTO users (id, username, first_name, last_name, is_bot, language_code, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       language_code = EXCLUDED.language_code,
       last_seen_at = now()`,
    [
      user.id,
      user.username ?? null,
      user.first_name,
      user.last_name ?? null,
      user.is_bot ?? false,
      user.language_code ?? null,
    ],
  );
}

export type UpsertGroupInput = {
  id: number;
  title: string;
  type: "group" | "supergroup" | "channel";
  username?: string | null;
};

export async function upsertGroup(group: UpsertGroupInput) {
  await pool.query(
    `INSERT INTO groups (id, title, type, username)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       type = EXCLUDED.type,
       username = EXCLUDED.username,
       is_active = TRUE`,
    [group.id, group.title, group.type, group.username ?? null],
  );
}

export type MemberStatus =
  | "member"
  | "administrator"
  | "creator"
  | "restricted"
  | "left"
  | "kicked";

export async function upsertGroupMember(
  groupId: number,
  userId: number,
  status: MemberStatus = "member",
) {
  const left = status === "left" || status === "kicked";
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, status, left_at)
     VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)
     ON CONFLICT (group_id, user_id) DO UPDATE SET
       status = EXCLUDED.status,
       left_at = CASE WHEN $4 THEN now() ELSE NULL END`,
    [groupId, userId, status, left],
  );
}

// ---------------------------------------------------------------------------
// user_wallets / wallet_transactions
// ---------------------------------------------------------------------------

export async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT balance FROM user_wallets WHERE user_id = $1`,
    [userId],
  );
  return rows.length ? Number(rows[0].balance) : 0;
}

/**
 * Adjusts a user's balance and records the change in the ledger. `amount`
 * is signed (negative to debit). Throws if a debit would push the balance
 * below zero — the `balance >= 0` CHECK constraint is the backstop, this
 * just gives a cleaner error before that.
 */
export async function addBalance(
  userId: number,
  amount: number,
  type: string,
  reference?: Record<string, unknown>,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO user_wallets (user_id, balance)
       VALUES ($1, GREATEST($2, 0))
       ON CONFLICT (user_id) DO UPDATE SET balance = user_wallets.balance + $2
       RETURNING balance`,
      [userId, amount],
    );
    const balanceAfter = Number(rows[0].balance);
    await client.query(
      `INSERT INTO wallet_transactions (user_id, amount, balance_after, type, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, amount, balanceAfter, type, reference ? JSON.stringify(reference) : null],
    );
    await client.query("COMMIT");
    return balanceAfter;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// user_levels / level_rewards
// ---------------------------------------------------------------------------

export type AddXpResult = {
  oldLevel: number;
  newLevel: number;
  xp: number;
  leveledUp: boolean;
};

/** Atomically awards XP and reports whether it crossed a level boundary. */
export async function addXp(
  userId: number,
  groupId: number,
  amount: number,
): Promise<AddXpResult> {
  const { rows } = await pool.query(
    `SELECT * FROM add_xp($1, $2, $3)`,
    [userId, groupId, amount],
  );
  const row = rows[0];
  const oldLevel = Number(row.old_level);
  const newLevel = Number(row.new_level);
  return { oldLevel, newLevel, xp: Number(row.total_xp), leveledUp: newLevel > oldLevel };
}

export async function getUserLevel(userId: number, groupId: number) {
  const { rows } = await pool.query(
    `SELECT xp, level, message_count FROM user_levels WHERE user_id = $1 AND group_id = $2`,
    [userId, groupId],
  );
  if (!rows.length) return { xp: 0, level: 0, message_count: 0 };
  return {
    xp: Number(rows[0].xp),
    level: Number(rows[0].level),
    message_count: Number(rows[0].message_count),
  };
}

/**
 * 1-based leaderboard position within a group, ranked by level then xp
 * (same ordering as user_levels_group_rank_idx). Returns null if the user
 * has no row yet — shouldn't happen right after addXp(), but guards
 * against a race either way.
 */
export async function getUserRank(userId: number, groupId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `WITH me AS (
       SELECT level, xp FROM user_levels WHERE user_id = $1 AND group_id = $2
     )
     SELECT (count(*) + 1) AS rank
     FROM user_levels, me
     WHERE user_levels.group_id = $2
       AND (
         user_levels.level > me.level
         OR (user_levels.level = me.level AND user_levels.xp > me.xp)
       )`,
    [userId, groupId],
  );
  if (!rows.length) return null;
  return Number(rows[0].rank);
}

export type LevelReward = { reward_points: number; message: string | null };

export async function getLevelReward(level: number): Promise<LevelReward | undefined> {
  const { rows } = await pool.query(
    `SELECT reward_coins, message FROM level_rewards WHERE level = $1`,
    [level],
  );
  if (!rows.length) return undefined;
  return { reward_points: Number(rows[0].reward_points), message: rows[0].message };
}
