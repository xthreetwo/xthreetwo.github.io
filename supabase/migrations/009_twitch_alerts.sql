-- Twitch alert settings, live events, and EventSub subscription tracking

ALTER TABLE twitch_tokens
ADD COLUMN IF NOT EXISTS scopes TEXT;

CREATE TABLE IF NOT EXISTS ticker_alert_settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (
    alert_type IN ('follow', 'subscribe', 'gift_sub', 'raid', 'cheer')
  ),
  enabled BOOLEAN NOT NULL DEFAULT true,
  template TEXT NOT NULL,
  sound_url TEXT NOT NULL,
  duration_ms INT NOT NULL DEFAULT 5000 CHECK (duration_ms > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_type)
);

DROP TRIGGER IF EXISTS ticker_alert_settings_updated_at ON ticker_alert_settings;
CREATE TRIGGER ticker_alert_settings_updated_at
  BEFORE UPDATE ON ticker_alert_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ticker_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own alert settings"
  ON ticker_alert_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own alert settings"
  ON ticker_alert_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own alert settings"
  ON ticker_alert_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own alert settings"
  ON ticker_alert_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS ticker_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (
    alert_type IN ('follow', 'subscribe', 'gift_sub', 'raid', 'cheer')
  ),
  display_text TEXT NOT NULL,
  sound_url TEXT NOT NULL,
  duration_ms INT NOT NULL DEFAULT 5000 CHECK (duration_ms > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ticker_alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read ticker_alert_events"
  ON ticker_alert_events
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated insert ticker_alert_events"
  ON ticker_alert_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS twitch_event_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  subscription_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id)
);

DROP TRIGGER IF EXISTS twitch_event_subscriptions_updated_at ON twitch_event_subscriptions;
CREATE TRIGGER twitch_event_subscriptions_updated_at
  BEFORE UPDATE ON twitch_event_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE twitch_event_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own event subscriptions"
  ON twitch_event_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE ticker_alert_events;
