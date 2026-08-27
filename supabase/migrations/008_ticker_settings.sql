-- Global ticker appearance settings (singleton row)

CREATE TABLE IF NOT EXISTS ticker_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  accent_color TEXT NOT NULL DEFAULT '#ff5b20',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ticker_settings (id, accent_color)
VALUES (1, '#ff5b20')
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS ticker_settings_updated_at ON ticker_settings;
CREATE TRIGGER ticker_settings_updated_at
  BEFORE UPDATE ON ticker_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ticker_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read ticker_settings"
  ON ticker_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated insert ticker_settings"
  ON ticker_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated update ticker_settings"
  ON ticker_settings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE ticker_settings;
