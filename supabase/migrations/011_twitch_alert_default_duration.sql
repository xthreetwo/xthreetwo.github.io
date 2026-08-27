-- Default alert duration: Twitch Alert preset (7 seconds)

ALTER TABLE ticker_alert_settings
  ALTER COLUMN duration_ms SET DEFAULT 7000;

ALTER TABLE ticker_alert_events
  ALTER COLUMN duration_ms SET DEFAULT 7000;

-- Align existing settings that used the old 5s default
UPDATE ticker_alert_settings
SET duration_ms = 7000
WHERE duration_ms = 5000;
