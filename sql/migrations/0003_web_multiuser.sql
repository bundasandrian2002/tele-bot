-- =========================================================================
-- web_users — accounts for the web dashboard (separate from Telegram
-- `users`). One dashboard account can own several bot_instances.
-- =========================================================================
CREATE TABLE IF NOT EXISTS web_users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS web_users_email_lower_idx
  ON web_users (lower(email));

DROP TRIGGER IF EXISTS web_users_set_updated_at ON web_users;
CREATE TRIGGER web_users_set_updated_at
  BEFORE UPDATE ON web_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- bot_instances — one row per Telegram bot token a dashboard user has
-- added. The token itself is never stored in plaintext: token_ciphertext
-- + token_iv + token_tag are AES-256-GCM output (see src/lib/crypto.ts),
-- decrypted only in-memory by the bot manager right before it's handed to
-- node-telegram-bot-api.
-- =========================================================================
CREATE TABLE IF NOT EXISTS bot_instances (
  id                  BIGSERIAL PRIMARY KEY,
  web_user_id         BIGINT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
  label               TEXT NOT NULL,
  token_ciphertext    TEXT NOT NULL,
  token_iv            TEXT NOT NULL,
  token_tag           TEXT NOT NULL,
  -- Last 6 chars of the real token, kept in plaintext purely so the
  -- dashboard can show "...ab12cd" instead of the full secret.
  token_last6         TEXT NOT NULL,
  -- `enabled` is user intent ("I want this bot running"); `status` is the
  -- manager's last observed runtime result. They're allowed to disagree
  -- briefly (e.g. enabled=true, status='error' after a bad token) — the
  -- dashboard shows both.
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  status              TEXT NOT NULL DEFAULT 'stopped'
                      CHECK (status IN ('stopped', 'starting', 'running', 'error')),
  last_error          TEXT,
  bot_username        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_instances_web_user_idx ON bot_instances (web_user_id);

DROP TRIGGER IF EXISTS bot_instances_set_updated_at ON bot_instances;
CREATE TRIGGER bot_instances_set_updated_at
  BEFORE UPDATE ON bot_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- bot_instance_settings — per-instance equivalent of the old global
-- bot_settings (prefix, developer mode, admin Telegram ids...), scoped by
-- bot_instance_id so multiple tenants' bots don't share state.
-- =========================================================================
CREATE TABLE IF NOT EXISTS bot_instance_settings (
  bot_instance_id  BIGINT NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  value            TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_instance_id, key)
);

DROP TRIGGER IF EXISTS bot_instance_settings_set_updated_at ON bot_instance_settings;
CREATE TRIGGER bot_instance_settings_set_updated_at
  BEFORE UPDATE ON bot_instance_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
