# Twitch News Ticker Overlay

An ESPN-style scrolling news ticker for Twitch streams, designed as a browser source in OBS or Streamlabs. Manage ticker items in real time through a password-protected admin panel backed by Supabase.

## URLs

| Page | URL | Purpose |
|------|-----|---------|
| Overlay | `https://xthreetwo.github.io/overlay.html` | Add as OBS Browser Source |
| Admin | `https://xthreetwo.github.io/admin.html` | Manage ticker items |

## Quick Start

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Open the **SQL Editor** and run the migration in [`supabase/migrations/001_ticker_items.sql`](supabase/migrations/001_ticker_items.sql).
3. Go to **Authentication → Users** and create your admin account (email + password).
4. Copy your project URL and anon key from **Settings → API**.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SPOTIFY_CLIENT_ID=your-spotify-client-id
```

### 3. Local development

```bash
npm install
npm run dev
```

- Overlay: http://localhost:5173/overlay.html
- Admin: http://localhost:5173/admin.html

### 4. Deploy to GitHub Pages

Add these repository secrets (**Settings → Secrets and variables → Actions**):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SPOTIFY_CLIENT_ID` (for Spotify now-playing ticker)

Push to `main` — GitHub Actions builds and deploys automatically.

Also enable GitHub Pages: **Settings → Pages → Source: GitHub Actions**.

## Spotify now-playing ticker (free)

Show the current Spotify track on your ticker while you stream.

### Setup

1. Create a free app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add redirect URIs:
   - `https://xthreetwo.github.io/admin.html`
   - `http://localhost:5173/admin.html` (local dev)
3. Copy the **Client ID** into `.env` as `VITE_SPOTIFY_CLIENT_ID` and into GitHub Actions secrets.
4. Run migration [`supabase/migrations/005_music_ticker.sql`](supabase/migrations/005_music_ticker.sql) in Supabase SQL Editor.

### Usage

1. Admin → **Connect Spotify** and authorize.
2. Click **Add Music Item** and keep it **Active**.
3. **Keep the admin tab open** during your stream — it polls Spotify every ~5 seconds and updates the overlay via Supabase Realtime.
4. Play music in Spotify (desktop or mobile with active playback).

Display format: `*Now Playing:* **Track - Artist**`

No Spotify Premium required for reading now playing. The Spotify API and Developer app are free.

## OBS Setup

1. In OBS, add a **Browser Source**.
2. Set URL to `https://xthreetwo.github.io/overlay.html`.
3. Set Width to `1920` and Height to `65` (ticker sits at the top of the canvas).
4. The background is transparent by default — no chroma key needed.
5. Check "Refresh browser when scene becomes active" if you want a clean reload on scene switch.

## Display time

Each item can use one of three preset durations (on screen after the slide-in animation):

| Preset | Duration |
|--------|----------|
| Default | 5 seconds |
| Extended | 10 seconds |
| Super | 15 seconds |

## Highlight Syntax

Use lightweight markdown in ticker item text:

| Syntax | Effect |
|--------|--------|
| `**!livery**` | Orange accent highlight |
| `*important*` | Bold text |
| `'emphasis'` | Italic text |

Example: `**!livery** in chat for the 'newest' i20 Livery`

Legacy `{accent}...{/accent}`, `{bold}...{/bold}`, and `{italic}...{/italic}` tags still work on older items.

## Customizing the Look

All visual tokens are CSS variables in [`src/overlay/overlay.css`](src/overlay/overlay.css):

```css
:root {
  --ticker-bg: #1a1a2e;
  --ticker-accent: #e63946;
  --ticker-text: #ffffff;
  --ticker-highlight: #ffd700;
  --ticker-speed: 40s;
  --ticker-height: 48px;
}
```

Change these values to match your stream branding. No code changes required.

## Project Structure

```
overlay.html          OBS browser source entry
admin.html            CMS admin entry
src/overlay/          Ticker rendering + realtime
src/admin/            Auth + CRUD panel
src/lib/              Supabase client + highlight parser
supabase/migrations/  Database schema + RLS policies
```

## License

Private — for personal streaming use.
