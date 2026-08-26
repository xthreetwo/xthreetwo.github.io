-- Music / Spotify now-playing ticker item type
ALTER TABLE ticker_items
ADD COLUMN IF NOT EXISTS music_track TEXT,
ADD COLUMN IF NOT EXISTS music_artist TEXT;

ALTER TABLE ticker_items
DROP CONSTRAINT IF EXISTS ticker_items_item_type_check;

ALTER TABLE ticker_items
ADD CONSTRAINT ticker_items_item_type_check
CHECK (item_type IN ('standard', 'acrally', 'music'));

-- Spotify OAuth tokens (one row per admin user)
CREATE TABLE IF NOT EXISTS spotify_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS spotify_tokens_updated_at ON spotify_tokens;
CREATE TRIGGER spotify_tokens_updated_at
  BEFORE UPDATE ON spotify_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE spotify_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own spotify tokens"
  ON spotify_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own spotify tokens"
  ON spotify_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own spotify tokens"
  ON spotify_tokens
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own spotify tokens"
  ON spotify_tokens
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
