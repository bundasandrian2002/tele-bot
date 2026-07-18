-- Fixes "column reference \"xp\" is ambiguous" in add_xp(): the function's
-- RETURNS TABLE output column was named "xp", identical to the
-- user_levels.xp table column, so every bare `xp` reference inside the
-- function body was ambiguous between the two. Renamed the output column
-- to total_xp and table-qualified the column references.
CREATE OR REPLACE FUNCTION add_xp(p_user_id BIGINT, p_group_id BIGINT, p_amount INT)
RETURNS TABLE(old_level INT, new_level INT, total_xp BIGINT) AS $$
DECLARE
  v_old_level INT;
  v_new_xp BIGINT;
  v_new_level INT;
BEGIN
  INSERT INTO user_levels (user_id, group_id)
  VALUES (p_user_id, p_group_id)
  ON CONFLICT (user_id, group_id) DO NOTHING;

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
