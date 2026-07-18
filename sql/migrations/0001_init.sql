-- Generic trigger function to keep `updated_at` current on every UPDATE,
-- used by every table below that has one.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- users — one row per Telegram user the bot has ever seen, across all chats.
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
  id             BIGINT PRIMARY KEY,          -- Telegram user id
  username       TEXT,                        -- nullable: not everyone has one, and it can change
  first_name     TEXT NOT NULL,
  last_name      TEXT,
  is_bot         BOOLEAN NOT NULL DEFAULT FALSE,
  language_code  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive username lookup (e.g. resolving "@Name" to an id),
-- skipping NULLs since most users won't have a unique conflict either way.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
  ON users (lower(username)) WHERE username IS NOT NULL;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- groups — one row per chat (group/supergroup/channel) the bot is active in.
-- =========================================================================
CREATE TABLE IF NOT EXISTS groups (
  id           BIGINT PRIMARY KEY,             -- Telegram chat id (negative for groups)
  title        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('group', 'supergroup', 'channel')),
  username     TEXT,
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-group overrides: prefix, botname, feature toggles...
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,       -- flips to false when the bot itself is removed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS groups_set_updated_at ON groups;
CREATE TRIGGER groups_set_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- group_members — membership + moderation status, one row per (group, user).
-- =========================================================================
CREATE TABLE IF NOT EXISTS group_members (
  group_id    BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'member'
              CHECK (status IN ('member', 'administrator', 'creator', 'restricted', 'left', 'kicked')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at     TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);

-- "which groups is user X in" / "list members of group Y by status" lookups.
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);
CREATE INDEX IF NOT EXISTS group_members_group_status_idx ON group_members (group_id, status);

-- =========================================================================
-- user_wallets — one global coin balance per user. Kept bot-wide (not
-- per-group) so a transfer or /daily behaves the same in every chat.
-- =========================================================================
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_wallets_set_updated_at ON user_wallets;
CREATE TRIGGER user_wallets_set_updated_at
  BEFORE UPDATE ON user_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only ledger backing every balance change, so balances are
-- auditable/debuggable instead of trusting a single mutable counter.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         BIGINT NOT NULL,              -- signed: positive credit, negative debit
  balance_after  BIGINT NOT NULL,
  type           TEXT NOT NULL,                -- e.g. 'levelup_reward', 'daily', 'transfer_in', 'admin_grant'
  reference      JSONB,                        -- free-form context, e.g. { "group_id": ..., "level": ... }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_idx ON wallet_transactions (user_id, created_at DESC);

-- =========================================================================
-- user_levels — XP/level is per-group (Discord/MEE6-style), one row per
-- (user, group) so activity in one chat doesn't inflate rank in another.
-- =========================================================================
CREATE TABLE IF NOT EXISTS user_levels (
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id       BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  xp             BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level          INT NOT NULL DEFAULT 0 CHECK (level >= 0),
  message_count  INT NOT NULL DEFAULT 0,
  last_xp_at     TIMESTAMPTZ,                  -- drives the anti-spam XP cooldown
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

-- Leaderboard queries: "top members of this group by level/xp".
CREATE INDEX IF NOT EXISTS user_levels_group_rank_idx ON user_levels (group_id, level DESC, xp DESC);

DROP TRIGGER IF EXISTS user_levels_set_updated_at ON user_levels;
CREATE TRIGGER user_levels_set_updated_at
  BEFORE UPDATE ON user_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- level_rewards — optional per-level customization for the rank-up event
-- (bonus coins and/or a custom announcement). A level with no row here
-- just gets the rank-up event's default reward/message.
-- =========================================================================
CREATE TABLE IF NOT EXISTS level_rewards (
  level         INT PRIMARY KEY CHECK (level > 0),
  reward_coins  BIGINT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  message       TEXT
);

-- =========================================================================
-- level_for_xp / add_xp — leveling math lives in the database so an XP
-- award is a single atomic round trip instead of the app reading xp,
-- computing a level in JS, then writing it back (which races under
-- concurrent messages from the same user).
--
-- Curve: the XP needed to go from level N to N+1 is 5*N^2 + 50*N + 100
-- (same shape popularized by MEE6) — early levels are quick, later ones
-- take meaningfully longer.
-- =========================================================================
CREATE OR REPLACE FUNCTION level_for_xp(p_xp BIGINT)
RETURNS INT AS $$
DECLARE
  lvl INT := 0;
  remaining BIGINT := p_xp;
  needed BIGINT;
BEGIN
  LOOP
    needed := 5 * lvl * lvl + 50 * lvl + 100;
    EXIT WHEN remaining < needed;
    remaining := remaining - needed;
    lvl := lvl + 1;
  END LOOP;
  RETURN lvl;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION add_xp(p_user_id BIGINT, p_group_id BIGINT, p_amount INT)
-- Output column named total_xp (not "xp") on purpose: RETURNS TABLE columns
-- become variables in scope for the whole function body, and a name that
-- exactly matches the user_levels.xp column makes every bare `xp`
-- reference below ambiguous between "the column" and "the output".
RETURNS TABLE(old_level INT, new_level INT, total_xp BIGINT) AS $$
DECLARE
  v_old_level INT;
  v_new_xp BIGINT;
  v_new_level INT;
BEGIN
  INSERT INTO user_levels (user_id, group_id)
  VALUES (p_user_id, p_group_id)
  ON CONFLICT (user_id, group_id) DO NOTHING;

  -- Lock the row before reading it, so two messages arriving at nearly the
  -- same instant can't both read the same starting xp and stomp on each
  -- other's update. Table-qualified for clarity, same reasoning as above.
  SELECT user_levels.level INTO v_old_level
  FROM user_levels
  WHERE user_id = p_user_id AND group_id = p_group_id
  FOR UPDATE;

  UPDATE user_levels
  SET xp = user_levels.xp + GREATEST(p_amount, 0),
      message_count = user_levels.message_count + 1,
      last_xp_at = now(),
      level = level_for_xp(user_levels.xp + GREATEST(p_amount, 0))
  WHERE user_id = p_user_id AND group_id = p_group_id
  RETURNING user_levels.xp, user_levels.level INTO v_new_xp, v_new_level;

  RETURN QUERY SELECT v_old_level, v_new_level, v_new_xp;
END;
$$ LANGUAGE plpgsql;
