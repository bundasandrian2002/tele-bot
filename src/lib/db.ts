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
// bot_settings — bot-wide key/value overrides (see sql/migrations/0002_bot_settings.sql)
// ---------------------------------------------------------------------------

export async function getBotSetting(key: string): Promise<string | undefined> {
  const { rows } = await pool.query(
    `SELECT value FROM bot_settings WHERE key = $1`,
    [key],
  );
  return rows.length ? (rows[0].value as string) : undefined;
}

export async function setBotSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO bot_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export async function deleteBotSetting(key: string): Promise<void> {
  await pool.query(`DELETE FROM bot_settings WHERE key = $1`, [key]);
}

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

export type ActiveGroup = { id: number; title: string };

/**
 * Every group the bot is still a member of (see upsertGroup /
 * `is_active`, which flips to false once the bot is removed from a
 * chat). Used by the AutoGreet scheduler (src/lib/autogreetScheduler.ts)
 * to broadcast the Morning/Afternoon/Evening/Night greeting to every
 * active group at once.
 */
export async function getActiveGroups(): Promise<ActiveGroup[]> {
  const { rows } = await pool.query(
    `SELECT id, title FROM groups WHERE is_active = TRUE`,
  );
  return rows.map((row) => ({ id: Number(row.id), title: row.title as string }));
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

/**
 * Timestamp of the user's most recent /daily claim (see
 * src/commands/daily.ts), or undefined if they've never claimed one.
 * Read from wallet_transactions rather than a dedicated column — 'daily'
 * claims are already recorded there via addBalance()'s `type` argument,
 * so this avoids a second source of truth that could drift from the ledger.
 */
export async function getLastDailyClaimAt(userId: number): Promise<Date | undefined> {
  const { rows } = await pool.query(
    `SELECT created_at FROM wallet_transactions
     WHERE user_id = $1 AND type = 'daily'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return rows.length ? (rows[0].created_at as Date) : undefined;
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

export type LevelReward = { reward_coins: number; message: string | null };

export async function getLevelReward(level: number): Promise<LevelReward | undefined> {
  const { rows } = await pool.query(
    `SELECT reward_coins, message FROM level_rewards WHERE level = $1`,
    [level],
  );
  if (!rows.length) return undefined;
  return { reward_coins: Number(rows[0].reward_coins), message: rows[0].message };
}

// ---------------------------------------------------------------------------
// web_users — dashboard accounts (see sql/migrations/0003_web_multiuser.sql)
// ---------------------------------------------------------------------------

export type WebUser = { id: number; email: string; password_hash: string };

export async function createWebUser(
  email: string,
  passwordHash: string,
): Promise<WebUser> {
  const { rows } = await pool.query(
    `INSERT INTO web_users (email, password_hash) VALUES ($1, $2)
     RETURNING id, email, password_hash`,
    [email, passwordHash],
  );
  return rows[0] as WebUser;
}

export async function getWebUserByEmail(email: string): Promise<WebUser | undefined> {
  const { rows } = await pool.query(
    `SELECT id, email, password_hash FROM web_users WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] as WebUser | undefined;
}

export async function getWebUserById(id: number): Promise<WebUser | undefined> {
  const { rows } = await pool.query(
    `SELECT id, email, password_hash FROM web_users WHERE id = $1`,
    [id],
  );
  return rows[0] as WebUser | undefined;
}

// ---------------------------------------------------------------------------
// bot_instances — one row per Telegram bot token a dashboard user added
// ---------------------------------------------------------------------------

export type BotInstanceStatus = "stopped" | "starting" | "running" | "error";

export type BotInstance = {
  id: number;
  web_user_id: number;
  label: string;
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  token_last6: string;
  enabled: boolean;
  status: BotInstanceStatus;
  last_error: string | null;
  bot_username: string | null;
  created_at: Date;
};

const BOT_INSTANCE_COLUMNS = `id, web_user_id, label, token_ciphertext, token_iv, token_tag,
   token_last6, enabled, status, last_error, bot_username, created_at`;

export async function createBotInstance(input: {
  webUserId: number;
  label: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
  tokenLast6: string;
}): Promise<BotInstance> {
  const { rows } = await pool.query(
    `INSERT INTO bot_instances
       (web_user_id, label, token_ciphertext, token_iv, token_tag, token_last6)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${BOT_INSTANCE_COLUMNS}`,
    [
      input.webUserId,
      input.label,
      input.tokenCiphertext,
      input.tokenIv,
      input.tokenTag,
      input.tokenLast6,
    ],
  );
  return rows[0] as BotInstance;
}

export async function listBotInstancesForUser(webUserId: number): Promise<BotInstance[]> {
  const { rows } = await pool.query(
    `SELECT ${BOT_INSTANCE_COLUMNS} FROM bot_instances WHERE web_user_id = $1 ORDER BY created_at ASC`,
    [webUserId],
  );
  return rows as BotInstance[];
}

/** Every instance with enabled = TRUE, across all users — used at boot to know what to start. */
export async function listEnabledBotInstances(): Promise<BotInstance[]> {
  const { rows } = await pool.query(
    `SELECT ${BOT_INSTANCE_COLUMNS} FROM bot_instances WHERE enabled = TRUE`,
  );
  return rows as BotInstance[];
}

export async function getBotInstance(id: number): Promise<BotInstance | undefined> {
  const { rows } = await pool.query(
    `SELECT ${BOT_INSTANCE_COLUMNS} FROM bot_instances WHERE id = $1`,
    [id],
  );
  return rows[0] as BotInstance | undefined;
}

/** Scoped to a specific owner so one dashboard user can't operate on another's bot by guessing an id. */
export async function getBotInstanceForUser(
  id: number,
  webUserId: number,
): Promise<BotInstance | undefined> {
  const { rows } = await pool.query(
    `SELECT ${BOT_INSTANCE_COLUMNS} FROM bot_instances WHERE id = $1 AND web_user_id = $2`,
    [id, webUserId],
  );
  return rows[0] as BotInstance | undefined;
}

export async function setBotInstanceEnabled(id: number, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE bot_instances SET enabled = $2 WHERE id = $1`, [id, enabled]);
}

export async function setBotInstanceStatus(
  id: number,
  status: BotInstanceStatus,
  lastError?: string | null,
  botUsername?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE bot_instances
     SET status = $2,
         last_error = $3,
         bot_username = COALESCE($4, bot_username)
     WHERE id = $1`,
    [id, status, lastError ?? null, botUsername ?? null],
  );
}

export async function deleteBotInstance(id: number): Promise<void> {
  await pool.query(`DELETE FROM bot_instances WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// bot_instance_settings — per-tenant equivalent of bot_settings (prefix,
// developer mode, admin Telegram ids...)
// ---------------------------------------------------------------------------

export async function getInstanceSetting(
  instanceId: number,
  key: string,
): Promise<string | undefined> {
  const { rows } = await pool.query(
    `SELECT value FROM bot_instance_settings WHERE bot_instance_id = $1 AND key = $2`,
    [instanceId, key],
  );
  return rows.length ? (rows[0].value as string) : undefined;
}

export async function setInstanceSetting(
  instanceId: number,
  key: string,
  value: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO bot_instance_settings (bot_instance_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (bot_instance_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [instanceId, key, value],
  );
}
