-- AC Rally Mode ticker item type with structured stage/rank fields
ALTER TABLE ticker_items
ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS acrally_stage TEXT,
ADD COLUMN IF NOT EXISTS acrally_rank TEXT;

ALTER TABLE ticker_items
DROP CONSTRAINT IF EXISTS ticker_items_item_type_check;

ALTER TABLE ticker_items
ADD CONSTRAINT ticker_items_item_type_check
CHECK (item_type IN ('standard', 'acrally'));
