-- Twitch stream title ticker item type
ALTER TABLE ticker_items
ADD COLUMN IF NOT EXISTS twitch_stream_title TEXT;

ALTER TABLE ticker_items
DROP CONSTRAINT IF EXISTS ticker_items_item_type_check;

ALTER TABLE ticker_items
ADD CONSTRAINT ticker_items_item_type_check
CHECK (item_type IN ('standard', 'acrally', 'music', 'stream_title'));

-- Twitch OAuth tokens (one row per admin user)
CREATE TABLE IF NOT EXISTS twitch_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  broadcaster_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS twitch_tokens_updated_at ON twitch_tokens;
CREATE TRIGGER twitch_tokens_updated_at
  BEFORE UPDATE ON twitch_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE twitch_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own twitch tokens"
  ON twitch_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own twitch tokens"
  ON twitch_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own twitch tokens"
  ON twitch_tokens
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own twitch tokens"
  ON twitch_tokens
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
