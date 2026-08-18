-- Per-item display duration (seconds on screen after enter animation)
ALTER TABLE ticker_items
ADD COLUMN IF NOT EXISTS hold_seconds INT NOT NULL DEFAULT 5;
