-- =========================================================================
-- bot_settings — bot-wide (not per-group) key/value overrides, e.g. the
-- command prefix. Separate from groups.settings, which is scoped to a
-- single chat; this table is for the one global chatbotConfig instead.
-- =========================================================================
CREATE TABLE IF NOT EXISTS bot_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS bot_settings_set_updated_at ON bot_settings;
CREATE TRIGGER bot_settings_set_updated_at
  BEFORE UPDATE ON bot_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
