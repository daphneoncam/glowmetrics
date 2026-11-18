-- Applied to production 2026-11-11. Logging RPC must only write the caller's own rows.
CREATE OR REPLACE FUNCTION log_paste_parse_attempt(
  p_user_id UUID, p_source TEXT, p_attempted_platform TEXT, p_claimed_platform TEXT DEFAULT NULL,
  p_supported BOOLEAN DEFAULT FALSE, p_raw_text TEXT DEFAULT NULL, p_line_count INTEGER DEFAULT NULL,
  p_has_tabs BOOLEAN DEFAULT NULL, p_has_commas BOOLEAN DEFAULT NULL, p_top_shapes TEXT[] DEFAULT NULL,
  p_parse_success BOOLEAN DEFAULT FALSE, p_error_reason TEXT DEFAULT NULL, p_error_details JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;
  INSERT INTO paste_parse_attempts (user_id, source, attempted_platform, claimed_platform, supported,
    raw_text, line_count, has_tabs, has_commas, top_shapes, parse_success, error_reason, error_details)
  VALUES (p_user_id, p_source, p_attempted_platform, p_claimed_platform, p_supported,
    p_raw_text, p_line_count, p_has_tabs, p_has_commas, p_top_shapes, p_parse_success, p_error_reason, p_error_details)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to log paste attempt: %', SQLERRM;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
