# Twitch News Ticker Overlay

An ESPN-style scrolling news ticker for Twitch streams, designed as a browser source in OBS or Streamlabs. Manage ticker items in real time through a password-protected admin panel backed by Supabase.

## URLs

| Page | URL | Purpose |
|------|-----|---------|
| Overlay | `https://xthreetwo.github.io/overlay.html` | Add as OBS Browser Source |
| Admin | `https://xthreetwo.github.io/admin.html` | Manage ticker items (`/admin` also works) |

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
VITE_TWITCH_CLIENT_ID=your-twitch-client-id
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
- `VITE_TWITCH_CLIENT_ID` (for Twitch stream title ticker)

Push to `main` — GitHub Actions builds and deploys automatically.

Also enable GitHub Pages: **Settings → Pages → Source: GitHub Actions**.

## Spotify now-playing ticker (free)

Show the current Spotify track on your ticker while you stream.

### Setup

1. Create a free app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add redirect URIs (must match exactly — Spotify OAuth always uses `/admin.html`):
   - `https://xthreetwo.github.io/admin.html`
   - `http://localhost:5173/admin.html` (local dev)
3. Copy the **Client ID** into `.env` as `VITE_SPOTIFY_CLIENT_ID` and into GitHub Actions secrets.
4. Run migrations in Supabase SQL Editor:
   - [`005_music_ticker.sql`](supabase/migrations/005_music_ticker.sql)
   - [`006_music_album_art.sql`](supabase/migrations/006_music_album_art.sql)

### Usage

1. Admin → **Connect Spotify** and authorize.
2. Click **Add Music Item** and keep it **Active**.
3. **Keep the admin tab open** during your stream — it polls Spotify every ~5 seconds and updates the overlay via Supabase Realtime.
4. Play music in Spotify (desktop or mobile with active playback).

Display format: `*Now Playing:*` album art thumbnail + `**Track - Artist**`

No Spotify Premium required for reading now playing. The Spotify API and Developer app are free.

## Twitch stream title ticker (free)

Show your current Twitch stream title on the ticker. Updates when you change the title in Twitch Creator Dashboard or before going live.

### Setup

1. Register an app in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Set the client type to **Public** (required for browser-based auth without a client secret).
2. OAuth redirect URIs are not required for device activation, but you may add them if you use other flows later:
   - `https://xthreetwo.github.io/admin.html`
   - `http://localhost:5173/admin.html` (local dev)
3. Copy the **Client ID** into `.env` as `VITE_TWITCH_CLIENT_ID` and into GitHub Actions secrets.
4. Run migration [`007_twitch_stream_title.sql`](supabase/migrations/007_twitch_stream_title.sql) in Supabase SQL Editor (or include it with migrations 005–006 if setting up fresh).

### Usage

1. Admin → **Connect Twitch** → open [twitch.tv/activate](https://www.twitch.tv/activate) and enter the code shown in the admin header.
2. Click **Add Stream Title Item** and keep it **Active**.
3. **Keep the admin tab open** during your stream — it polls Twitch every ~5 minutes and updates the overlay via Supabase Realtime.

Display format: Twitch icon + `**Your title here**`

## Twitch alerts (follow, sub, gift sub, raid, cheer)

Real-time Twitch alerts on the overlay via EventSub webhooks. The ticker pauses during each alert and resumes rotation without resetting.

### Setup

1. Run migration [`009_twitch_alerts.sql`](supabase/migrations/009_twitch_alerts.sql) in Supabase SQL Editor.
2. Deploy Edge Functions (Supabase CLI):
   ```bash
   supabase functions deploy twitch-eventsub twitch-eventsub-register
   ```
3. Set Edge Function secrets in **Supabase Dashboard → Edge Functions → Secrets**:
   - `TWITCH_CLIENT_ID` — same as your Vite env
   - `TWITCH_EVENTSUB_SECRET` — random string you choose (also used when creating subscriptions)
4. In [Twitch Developer Console](https://dev.twitch.tv/console/apps), ensure your app is **Public** and supports EventSub webhooks. The callback URL is:
   `https://<your-project-ref>.supabase.co/functions/v1/twitch-eventsub`
5. **Disconnect and reconnect Twitch** in admin after deploying (new OAuth scopes are required).

### Usage

1. Admin → **Connect Twitch** (device activation at [twitch.tv/activate](https://www.twitch.tv/activate)).
2. Open **Settings** → **Enable alerts** to register EventSub subscriptions.
3. Customize per-type templates, sounds, and duration in Settings. Use **Test** to fire a sample alert on the overlay.
4. Overlay does **not** require the admin tab during stream — alerts arrive via Supabase Realtime.

### Streamlabs / OBS audio

1. Browser Source URL: `https://xthreetwo.github.io/overlay.html` (or your Pages URL).
2. Enable **Control audio via OBS** / browser-source audio in Streamlabs so alert sounds play.
3. Run a **Test** alert from Settings before going live.

Default sounds live in [`public/sounds/`](public/sounds/) — replace `follow.mp3`, `subscribe.mp3`, etc. with your own clips.

## OBS Setup

1. In OBS, add a **Browser Source**.
2. Set URL to `https://xthreetwo.github.io/overlay.html`.
3. Set Width to `1920` and Height to `65` (ticker sits at the top of the canvas).
4. The background is transparent by default — no chroma key needed.
5. For Twitch alert sounds, enable browser-source audio (see Twitch alerts section above).
6. Check "Refresh browser when scene becomes active" if you want a clean reload on scene switch.

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
