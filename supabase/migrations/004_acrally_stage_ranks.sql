-- Per-stage rank memory for AC Rally items (stage name -> rank)
ALTER TABLE ticker_items
ADD COLUMN IF NOT EXISTS acrally_stage_ranks JSONB NOT NULL DEFAULT '{}'::jsonb;
