-- ticker_items table
CREATE TABLE IF NOT EXISTS ticker_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ticker_items_updated_at ON ticker_items;
CREATE TRIGGER ticker_items_updated_at
  BEFORE UPDATE ON ticker_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE ticker_items ENABLE ROW LEVEL SECURITY;

-- Public read access (overlay uses anon key)
CREATE POLICY "Public read access"
  ON ticker_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated write access
CREATE POLICY "Authenticated insert"
  ON ticker_items
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated update"
  ON ticker_items
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated delete"
  ON ticker_items
  FOR DELETE
  TO authenticated
  USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE ticker_items;

-- Sample data (optional — remove if not wanted)
INSERT INTO ticker_items (text, sort_order, active) VALUES
  ('**BREAKING** Welcome to the stream!', 0, true),
  ('Follow for more content — new videos every week', 1, true),
  ('*Tip:* Use the admin panel to manage ticker items in real time', 2, true);
