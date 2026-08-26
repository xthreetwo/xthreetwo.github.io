-- Album art URL for Spotify now-playing items (Spotify CDN URL)
ALTER TABLE ticker_items
ADD COLUMN IF NOT EXISTS music_album_art_url TEXT;
