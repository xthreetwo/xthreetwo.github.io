import "./admin.css";
import { supabase } from "../lib/supabase";
import { renderHighlights } from "../lib/parseHighlights";
import type { TickerItem } from "../shared/types";
import {
  formatAcrallyDisplayText,
  formatAcrallyText,
  formatHoldLabel,
  formatMusicLabel,
  formatMusicText,
  formatMusicTitle,
  formatStreamTitleText,
  formatStreamTitleValue,
  getItemDisplayText,
  isAcrallyItem,
  isMusicItem,
  isStreamTitleItem,
  parseAcrallyStageRanks,
  presetFromSeconds,
  secondsFromPreset,
  withAcrallyRankForStage,
  DEFAULT_HOLD_SECONDS,
} from "../shared/types";
import {
  getDefaultAcrallyStage,
  renderAcrallyStageOptions,
} from "../shared/acrallyStages";
import { renderDisconnectIconMarkup } from "../shared/disconnectIcon";
import { renderSpotifyIconMarkup } from "../shared/spotifyIcon";
import { renderTwitchIconMarkup } from "../shared/twitchIcon";
import {
  clearSpotifyCallbackParams,
  exchangeSpotifyCode,
  fetchCurrentlyPlaying,
  isSpotifyConfigured,
  isSpotifyOAuthCallback,
  isSpotifyTokenExpired,
  parseSpotifyCallbackCode,
  refreshSpotifyAccessToken,
  spotifyExpiresAt,
  startSpotifyAuth,
} from "../lib/spotify";
import {
  pollTwitchDeviceToken,
  requestTwitchDeviceCode,
  isTwitchConfigured,
  isTwitchTokenExpired,
  refreshTwitchAccessToken,
  twitchExpiresAt,
  validateTwitchToken,
  fetchChannelTitle,
  type TwitchDeviceCodeResponse,
  type TwitchTokenResponse,
} from "../lib/twitch";
import type { Session } from "@supabase/supabase-js";
import {
  applyTickerAccent,
  DEFAULT_TICKER_ACCENT,
  fetchTickerAccent,
  normalizeHexColor,
  saveTickerAccent,
} from "../lib/tickerTheme";

interface SpotifyTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface TwitchTokenRow {
  broadcaster_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

const SPOTIFY_POLL_MS = 5000;
const TWITCH_POLL_MS = 300000;

const app = document.getElementById("app")!;

let session: Session | null = null;
let items: TickerItem[] = [];
let showAddForm = false;
let showAddAcrallyForm = false;
let draggedId: string | null = null;
let spotifyTokens: SpotifyTokenRow | null = null;
let spotifyPollTimer: ReturnType<typeof setInterval> | null = null;
/** Music items the user manually turned off — skip auto-enable until they turn back on. */
const musicAutoSyncSuppressedIds = new Set<string>();
let twitchTokens: TwitchTokenRow | null = null;
let twitchPollTimer: ReturnType<typeof setInterval> | null = null;
let twitchDeviceAuth: TwitchDeviceCodeResponse | null = null;
let twitchDevicePollTimer: ReturnType<typeof setInterval> | null = null;
let tickerAccentColor = DEFAULT_TICKER_ACCENT;
let showSettingsModal = false;

// --- Auth ---

async function init(): Promise<void> {
  await loadTickerAccent();

  const { data } = await supabase.auth.getSession();
  session = data.session;

  if (session) {
    await handleOAuthCallbacksIfPresent();
    await loadItems();
    await loadSpotifyTokens();
    await loadTwitchTokens();
  }

  render();

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    stopSpotifyPoller();
    stopTwitchPoller();
    if (newSession) {
      await loadItems();
      await loadSpotifyTokens();
      await loadTwitchTokens();
    } else {
      spotifyTokens = null;
      twitchTokens = null;
    }
    render();
  });
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="auth-card">
      <h1>Ticker Admin</h1>
      <p>Sign in to manage your stream ticker items.</p>
      <div id="auth-error"></div>
      <form id="login-form">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn--primary" style="width:100%;margin-top:0.5rem">
          Sign In
        </button>
      </form>
    </div>
  `;

  document.getElementById("login-form")!.addEventListener("submit", handleLogin);
}

async function handleLogin(e: Event): Promise<void> {
  e.preventDefault();
  const email = (document.getElementById("email") as HTMLInputElement).value;
  const password = (document.getElementById("password") as HTMLInputElement).value;
  const errorEl = document.getElementById("auth-error")!;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.innerHTML = `<div class="alert alert--error">${escapeHtml(error.message)}</div>`;
  }
}

async function handleLogout(): Promise<void> {
  stopSpotifyPoller();
  stopTwitchPoller();
  stopTwitchDevicePoll();
  twitchDeviceAuth = null;
  musicAutoSyncSuppressedIds.clear();
  await supabase.auth.signOut();
}

// --- Data ---

async function loadItems(): Promise<void> {
  const { data, error } = await supabase
    .from("ticker_items")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to load items:", error.message);
    return;
  }

  items = data ?? [];
}

async function loadTickerAccent(): Promise<void> {
  tickerAccentColor = await fetchTickerAccent();
}

function nextSortOrder(): number {
  return items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0;
}

async function addItem(text: string, hold_seconds: number): Promise<void> {
  const { error } = await supabase.from("ticker_items").insert({
    text,
    sort_order: nextSortOrder(),
    active: true,
    hold_seconds,
    item_type: "standard",
  });

  if (error) {
    alert(`Failed to add item: ${error.message}`);
    return;
  }

  await loadItems();
  showAddForm = false;
  renderDashboard();
}

async function addAcrallyItem(
  stage: string,
  rank: string,
  hold_seconds: number
): Promise<void> {
  const text = formatAcrallyText(stage, rank);

  const { error } = await supabase.from("ticker_items").insert({
    text,
    sort_order: nextSortOrder(),
    active: true,
    hold_seconds,
    item_type: "acrally",
    acrally_stage: stage,
    acrally_rank: rank,
    acrally_stage_ranks: { [stage]: rank },
  });

  if (error) {
    alert(`Failed to add AC Rally item: ${error.message}`);
    return;
  }

  await loadItems();
  showAddAcrallyForm = false;
  renderDashboard();
}

async function updateItem(id: string, updates: Partial<TickerItem>): Promise<void> {
  const { error } = await supabase.from("ticker_items").update(updates).eq("id", id);

  if (error) {
    alert(`Failed to update item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function updateAcrallyFields(
  id: string,
  updates: { stage?: string; rank?: string }
): Promise<boolean> {
  const item = items.find((i) => i.id === id);
  if (!item || !isAcrallyItem(item)) return false;

  const currentStage = (item.acrally_stage ?? getDefaultAcrallyStage()).trim();
  let stageRanks = parseAcrallyStageRanks(item.acrally_stage_ranks);
  let stage: string;
  let rank: string;

  if (updates.rank !== undefined) {
    stage = currentStage;
    rank = updates.rank.trim();
    if (!rank) return false;
    stageRanks = withAcrallyRankForStage(stageRanks, stage, rank);
  } else if (updates.stage !== undefined) {
    stage = updates.stage.trim();
    rank = stageRanks[stage]?.trim() ?? "";
  } else {
    return false;
  }

  const stageChanged = stage !== currentStage;
  const rankChanged = rank !== (item.acrally_rank ?? "").trim();
  if (!stageChanged && !rankChanged) return false;

  const text = formatAcrallyDisplayText(stage, rank);

  const { error } = await supabase
    .from("ticker_items")
    .update({
      acrally_stage: stage,
      acrally_rank: rank,
      acrally_stage_ranks: stageRanks,
      text,
    })
    .eq("id", id);

  if (error) {
    alert(`Failed to update AC Rally item: ${error.message}`);
    return false;
  }

  item.acrally_stage = stage;
  item.acrally_rank = rank;
  item.acrally_stage_ranks = stageRanks;
  item.text = text;

  const previewEl = document.getElementById(`text-${id}`);
  if (previewEl) {
    previewEl.innerHTML = renderHighlights(getItemDisplayText(item));
  }

  if (updates.stage !== undefined) {
    const rankInput = document.getElementById(`rank-${id}`) as HTMLInputElement | null;
    if (rankInput) {
      rankInput.value = rank;
    }
  }

  return true;
}

async function updateAcrallyRank(id: string, rank: string): Promise<boolean> {
  return updateAcrallyFields(id, { rank });
}

async function updateAcrallyStage(id: string, stage: string): Promise<boolean> {
  return updateAcrallyFields(id, { stage });
}

async function addMusicItem(hold_seconds: number): Promise<void> {
  const text = formatMusicText("", "");

  const { error } = await supabase.from("ticker_items").insert({
    text,
    sort_order: nextSortOrder(),
    active: true,
    hold_seconds,
    item_type: "music",
    music_track: "",
    music_artist: "",
    music_album_art_url: "",
  });

  if (error) {
    alert(`Failed to add music item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function updateMusicItemFields(
  id: string,
  track: string,
  artist: string,
  albumArtUrl: string
): Promise<boolean> {
  const item = items.find((i) => i.id === id);
  if (!item || !isMusicItem(item)) return false;

  const prevTrack = (item.music_track ?? "").trim();
  const prevArtist = (item.music_artist ?? "").trim();
  const prevAlbumArt = (item.music_album_art_url ?? "").trim();
  if (track === prevTrack && artist === prevArtist && albumArtUrl === prevAlbumArt) {
    return false;
  }

  const text = formatMusicText(track, artist);

  const { error } = await supabase
    .from("ticker_items")
    .update({
      music_track: track,
      music_artist: artist,
      music_album_art_url: albumArtUrl,
      text,
    })
    .eq("id", id);

  if (error) {
    console.error("Failed to update music item:", error.message);
    return false;
  }

  item.music_track = track;
  item.music_artist = artist;
  item.music_album_art_url = albumArtUrl;
  item.text = text;

  const previewEl = document.getElementById(`text-${id}`);
  if (previewEl) {
    previewEl.innerHTML = renderMusicItemPreview(item);
  }

  return true;
}

function hasMusicItems(): boolean {
  return items.some((item) => isMusicItem(item));
}

async function setMusicItemActive(id: string, active: boolean): Promise<boolean> {
  const item = items.find((i) => i.id === id);
  if (!item || !isMusicItem(item)) return false;
  if (item.active === active) return false;

  const { error } = await supabase.from("ticker_items").update({ active }).eq("id", id);
  if (error) {
    console.error("Failed to update music item active state:", error.message);
    return false;
  }

  item.active = active;

  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.toggle("item-card--inactive", !active);
    const toggle = card.querySelector(".toggle-active") as HTMLInputElement | null;
    if (toggle) toggle.checked = active;

    const meta = card.querySelector(".item-card__meta");
    if (meta) {
      const holdPart = formatHoldLabel(item.hold_seconds);
      const suppressed = musicAutoSyncSuppressedIds.has(id);
      const statusNote = spotifyTokens
        ? suppressed
          ? "Paused for this session"
          : "Auto on when music plays"
        : "Connect Spotify to sync";
      meta.textContent = `${statusNote} · Display: ${holdPart}`;
    }
  }

  return true;
}

async function addStreamTitleItem(hold_seconds: number): Promise<void> {
  const text = formatStreamTitleText("");

  const { error } = await supabase.from("ticker_items").insert({
    text,
    sort_order: nextSortOrder(),
    active: true,
    hold_seconds,
    item_type: "stream_title",
    twitch_stream_title: "",
  });

  if (error) {
    alert(`Failed to add stream title item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function updateStreamTitleItemFields(id: string, title: string): Promise<boolean> {
  const item = items.find((i) => i.id === id);
  if (!item || !isStreamTitleItem(item)) return false;

  const prevTitle = (item.twitch_stream_title ?? "").trim();
  if (title === prevTitle) return false;

  const text = formatStreamTitleText(title);

  const { error } = await supabase
    .from("ticker_items")
    .update({
      twitch_stream_title: title,
      text,
    })
    .eq("id", id);

  if (error) {
    console.error("Failed to update stream title item:", error.message);
    return false;
  }

  item.twitch_stream_title = title;
  item.text = text;

  const previewEl = document.getElementById(`text-${id}`);
  if (previewEl) {
    previewEl.innerHTML = renderStreamTitleItemPreview(item);
  }

  return true;
}

function hasActiveStreamTitleItems(): boolean {
  return items.some((item) => isStreamTitleItem(item) && item.active);
}

async function loadTwitchTokens(): Promise<void> {
  if (!session?.user) {
    twitchTokens = null;
    return;
  }

  const { data, error } = await supabase
    .from("twitch_tokens")
    .select("broadcaster_id, access_token, refresh_token, expires_at")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load Twitch tokens:", error.message);
    twitchTokens = null;
    return;
  }

  twitchTokens = data ?? null;
}

async function saveTwitchTokens(
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
  broadcasterId: string
): Promise<boolean> {
  if (!session?.user) return false;

  const { error } = await supabase.from("twitch_tokens").upsert({
    user_id: session.user.id,
    broadcaster_id: broadcasterId,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });

  if (error) {
    alert(`Failed to save Twitch connection: ${error.message}`);
    return false;
  }

  twitchTokens = {
    broadcaster_id: broadcasterId,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  };

  return true;
}

async function disconnectTwitch(): Promise<void> {
  stopTwitchPoller();
  stopTwitchDevicePoll();

  if (session?.user) {
    const { error } = await supabase
      .from("twitch_tokens")
      .delete()
      .eq("user_id", session.user.id);

    if (error) {
      alert(`Failed to disconnect Twitch: ${error.message}`);
      return;
    }
  }

  twitchTokens = null;
  twitchDeviceAuth = null;
  renderDashboard();
}

async function handleOAuthCallbacksIfPresent(): Promise<void> {
  if (isSpotifyOAuthCallback()) {
    await handleSpotifyOAuthCallbackIfPresent();
  }
}

async function startTwitchDeviceConnect(): Promise<void> {
  stopTwitchDevicePoll();
  twitchDeviceAuth = null;

  const deviceCode = await requestTwitchDeviceCode();
  if (!deviceCode) {
    alert("Failed to start Twitch authorization. Check your Client ID and try again.");
    return;
  }

  twitchDeviceAuth = deviceCode;
  renderDashboard();
  startTwitchDevicePoll(deviceCode);
}

function stopTwitchDevicePoll(): void {
  if (twitchDevicePollTimer !== null) {
    clearInterval(twitchDevicePollTimer);
    twitchDevicePollTimer = null;
  }
}

async function completeTwitchDeviceAuth(tokenResponse: TwitchTokenResponse): Promise<void> {
  const refreshToken = tokenResponse.refresh_token;
  if (!refreshToken) {
    alert("Twitch did not return a refresh token. Please try connecting again.");
    renderDashboard();
    return;
  }

  const validated = await validateTwitchToken(tokenResponse.access_token);
  if (!validated?.user_id) {
    alert("Twitch authorization failed. Could not verify your account.");
    renderDashboard();
    return;
  }

  const saved = await saveTwitchTokens(
    tokenResponse.access_token,
    refreshToken,
    twitchExpiresAt(tokenResponse.expires_in),
    validated.user_id
  );

  if (!saved) {
    renderDashboard();
    return;
  }

  renderDashboard();
}

function startTwitchDevicePoll(deviceCode: TwitchDeviceCodeResponse): void {
  stopTwitchDevicePoll();

  let pollMs = Math.max(deviceCode.interval, 5) * 1000;

  const poll = async (): Promise<void> => {
    const result = await pollTwitchDeviceToken(deviceCode.device_code);

    if (result.status === "slow_down") {
      pollMs = Math.min(pollMs + 2000, 15000);
      stopTwitchDevicePoll();
      twitchDevicePollTimer = window.setInterval(poll, pollMs);
      return;
    }

    if (result.status === "pending") {
      return;
    }

    stopTwitchDevicePoll();
    twitchDeviceAuth = null;

    if (result.status === "success" && result.tokens) {
      await completeTwitchDeviceAuth(result.tokens);
      return;
    }

    alert(result.message ?? "Twitch authorization failed. Please try connecting again.");
    renderDashboard();
  };

  twitchDevicePollTimer = window.setInterval(poll, pollMs);
  poll();
}

function cancelTwitchDeviceConnect(): void {
  stopTwitchDevicePoll();
  twitchDeviceAuth = null;
  renderDashboard();
}

async function ensureTwitchAccessToken(): Promise<string | null> {
  if (!twitchTokens) return null;

  if (!isTwitchTokenExpired(twitchTokens.expires_at)) {
    return twitchTokens.access_token;
  }

  const refreshed = await refreshTwitchAccessToken(twitchTokens.refresh_token);
  if (!refreshed) {
    console.error("Twitch token refresh failed");
    return null;
  }

  const refreshToken = refreshed.refresh_token ?? twitchTokens.refresh_token;
  const expiresAt = twitchExpiresAt(refreshed.expires_in);
  const saved = await saveTwitchTokens(
    refreshed.access_token,
    refreshToken,
    expiresAt,
    twitchTokens.broadcaster_id
  );
  if (!saved) return null;

  return refreshed.access_token;
}

async function pollTwitchStreamTitle(): Promise<void> {
  if (!twitchTokens || !hasActiveStreamTitleItems()) return;

  const accessToken = await ensureTwitchAccessToken();
  if (!accessToken) return;

  try {
    const title = await fetchChannelTitle(accessToken, twitchTokens.broadcaster_id);
    const streamTitle = title ?? "";

    for (const item of items) {
      if (!isStreamTitleItem(item) || !item.active) continue;
      await updateStreamTitleItemFields(item.id, streamTitle);
    }
  } catch (error) {
    console.error("Twitch poll failed:", error);
  }
}

function startTwitchPoller(): void {
  stopTwitchPoller();

  if (!twitchTokens || !hasActiveStreamTitleItems()) return;

  twitchPollTimer = window.setInterval(() => {
    pollTwitchStreamTitle();
  }, TWITCH_POLL_MS);

  pollTwitchStreamTitle();
}

function stopTwitchPoller(): void {
  if (twitchPollTimer !== null) {
    clearInterval(twitchPollTimer);
    twitchPollTimer = null;
  }
}

function renderSpotifyBrandMarkup(): string {
  return `<span class="spotify-panel__brand" aria-label="Spotify" title="Spotify">${renderSpotifyIconMarkup("spotify-panel__icon")}</span>`;
}

function renderTwitchBrandMarkup(): string {
  return `<span class="twitch-panel__brand" aria-label="Twitch" title="Twitch">${renderTwitchIconMarkup("twitch-panel__icon")}</span>`;
}

function renderTwitchStatusMarkup(): string {
  if (!isTwitchConfigured()) {
    return `
      <div class="twitch-panel twitch-panel--disabled">
        ${renderTwitchBrandMarkup()}
        <span class="twitch-panel__status">Add VITE_TWITCH_CLIENT_ID to enable</span>
      </div>
    `;
  }

  if (twitchDeviceAuth) {
    const activateUrl = twitchDeviceAuth.verification_uri;
    const userCode = twitchDeviceAuth.user_code;

    return `
      <div class="twitch-panel twitch-panel--device">
        ${renderTwitchBrandMarkup()}
        <span class="twitch-panel__status">Enter code <strong>${escapeHtml(userCode)}</strong> at
          <a href="${escapeHtml(activateUrl)}" target="_blank" rel="noopener noreferrer">twitch.tv/activate</a>
        </span>
        <button type="button" id="twitch-cancel-device-btn" class="btn btn--sm btn--ghost">Cancel</button>
      </div>
    `;
  }

  const connected = Boolean(twitchTokens);
  const statusText = connected ? "Connected" : "Not connected";

  const actionButton = connected
    ? `<button type="button" id="twitch-disconnect-btn" class="btn btn--disconnect" aria-label="Disconnect Twitch" title="Disconnect Twitch">${renderDisconnectIconMarkup()}</button>`
    : `<button type="button" id="twitch-connect-btn" class="btn btn--sm btn--twitch">Connect</button>`;

  return `
    <div class="twitch-panel ${connected ? "twitch-panel--connected" : ""}">
      ${renderTwitchBrandMarkup()}
      <span class="twitch-panel__status">${statusText}</span>
      ${actionButton}
    </div>
  `;
}

async function loadSpotifyTokens(): Promise<void> {
  if (!session?.user) {
    spotifyTokens = null;
    return;
  }

  const { data, error } = await supabase
    .from("spotify_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load Spotify tokens:", error.message);
    spotifyTokens = null;
    return;
  }

  spotifyTokens = data ?? null;
}

async function saveSpotifyTokens(
  accessToken: string,
  refreshToken: string,
  expiresAt: string
): Promise<boolean> {
  if (!session?.user) return false;

  const { error } = await supabase.from("spotify_tokens").upsert({
    user_id: session.user.id,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });

  if (error) {
    alert(`Failed to save Spotify connection: ${error.message}`);
    return false;
  }

  spotifyTokens = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  };

  return true;
}

async function disconnectSpotify(): Promise<void> {
  stopSpotifyPoller();

  if (session?.user) {
    const { error } = await supabase
      .from("spotify_tokens")
      .delete()
      .eq("user_id", session.user.id);

    if (error) {
      alert(`Failed to disconnect Spotify: ${error.message}`);
      return;
    }
  }

  spotifyTokens = null;
  renderDashboard();
}

async function handleSpotifyOAuthCallbackIfPresent(): Promise<void> {
  const code = parseSpotifyCallbackCode();
  if (!code) return;

  clearSpotifyCallbackParams();

  const tokenResponse = await exchangeSpotifyCode(code);
  if (!tokenResponse) {
    alert("Spotify authorization failed. Please try connecting again.");
    return;
  }

  const refreshToken = tokenResponse.refresh_token ?? spotifyTokens?.refresh_token;
  if (!refreshToken) {
    alert("Spotify did not return a refresh token. Disconnect and connect again.");
    return;
  }

  await saveSpotifyTokens(
    tokenResponse.access_token,
    refreshToken,
    spotifyExpiresAt(tokenResponse.expires_in)
  );
}

async function ensureSpotifyAccessToken(): Promise<string | null> {
  if (!spotifyTokens) return null;

  if (!isSpotifyTokenExpired(spotifyTokens.expires_at)) {
    return spotifyTokens.access_token;
  }

  const refreshed = await refreshSpotifyAccessToken(spotifyTokens.refresh_token);
  if (!refreshed) {
    console.error("Spotify token refresh failed");
    return null;
  }

  const refreshToken = refreshed.refresh_token ?? spotifyTokens.refresh_token;
  const expiresAt = spotifyExpiresAt(refreshed.expires_in);
  const saved = await saveSpotifyTokens(refreshed.access_token, refreshToken, expiresAt);
  if (!saved) return null;

  return refreshed.access_token;
}

async function pollSpotifyNowPlaying(): Promise<void> {
  if (!spotifyTokens || !hasMusicItems()) return;

  const accessToken = await ensureSpotifyAccessToken();
  if (!accessToken) return;

  try {
    const nowPlaying = await fetchCurrentlyPlaying(accessToken);
    const track = nowPlaying?.track ?? "";
    const artist = nowPlaying?.artist ?? "";
    const albumArtUrl = nowPlaying?.albumArtUrl ?? "";
    const isPlaying = Boolean(track.trim());

    for (const item of items) {
      if (!isMusicItem(item)) continue;

      await updateMusicItemFields(item.id, track, artist, albumArtUrl);

      if (!isPlaying) {
        await setMusicItemActive(item.id, false);
      } else if (!musicAutoSyncSuppressedIds.has(item.id)) {
        await setMusicItemActive(item.id, true);
      }
    }
  } catch (error) {
    console.error("Spotify poll failed:", error);
  }
}

function startSpotifyPoller(): void {
  stopSpotifyPoller();

  if (!spotifyTokens || !hasMusicItems()) return;

  spotifyPollTimer = window.setInterval(() => {
    pollSpotifyNowPlaying();
  }, SPOTIFY_POLL_MS);

  pollSpotifyNowPlaying();
}

function stopSpotifyPoller(): void {
  if (spotifyPollTimer !== null) {
    clearInterval(spotifyPollTimer);
    spotifyPollTimer = null;
  }
}

function renderSpotifyStatusMarkup(): string {
  if (!isSpotifyConfigured()) {
    return `
      <div class="spotify-panel spotify-panel--disabled">
        ${renderSpotifyBrandMarkup()}
        <span class="spotify-panel__status">Add VITE_SPOTIFY_CLIENT_ID to enable</span>
      </div>
    `;
  }

  const connected = Boolean(spotifyTokens);
  const statusText = connected ? "Connected" : "Not connected";

  const actionButton = connected
    ? `<button type="button" id="spotify-disconnect-btn" class="btn btn--disconnect" aria-label="Disconnect Spotify" title="Disconnect Spotify">${renderDisconnectIconMarkup()}</button>`
    : `<button type="button" id="spotify-connect-btn" class="btn btn--sm btn--music">Connect</button>`;

  return `
    <div class="spotify-panel ${connected ? "spotify-panel--connected" : ""}">
      ${renderSpotifyBrandMarkup()}
      <span class="spotify-panel__status">${statusText}</span>
      ${actionButton}
    </div>
  `;
}

async function deleteItem(id: string): Promise<void> {
  if (!confirm("Delete this ticker item?")) return;

  musicAutoSyncSuppressedIds.delete(id);

  const { error } = await supabase.from("ticker_items").delete().eq("id", id);

  if (error) {
    alert(`Failed to delete item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function reorderItems(fromIndex: number, toIndex: number): Promise<void> {
  if (fromIndex === toIndex) return;

  const reordered = [...items];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  const updates = reordered.map((item, index) =>
    supabase.from("ticker_items").update({ sort_order: index }).eq("id", item.id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    alert(`Failed to reorder: ${failed.error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

// --- Render ---

function render(): void {
  if (!session) {
    renderLogin();
  } else {
    renderDashboard();
  }
}

function renderHoldSelect(id: string, selectedSeconds?: number): string {
  const selected = presetFromSeconds(selectedSeconds);
  return `
    <select id="${id}" class="hold-select">
      <option value="default" ${selected === "default" ? "selected" : ""}>Default (5s)</option>
      <option value="extended" ${selected === "extended" ? "selected" : ""}>Extended (10s)</option>
      <option value="super" ${selected === "super" ? "selected" : ""}>Super (15s)</option>
    </select>
  `;
}

function renderStageOptionsMarkup(selected?: string): string {
  return renderAcrallyStageOptions(selected, escapeHtml);
}

function renderStageSelect(id: string, selected?: string): string {
  return `<select id="${id}" class="stage-select">${renderStageOptionsMarkup(selected)}</select>`;
}

function renderSectionHeaderActions(): string {
  const previewBtn = `<a href="/overlay.html" target="_blank" rel="noopener noreferrer" class="btn btn--secondary">Preview Overlay</a>`;

  if (showAddForm || showAddAcrallyForm) {
    return `<div class="section-header__actions">${previewBtn}</div>`;
  }

  return `
    <div class="section-header__actions">
      ${previewBtn}
      <details class="add-dropdown" id="add-dropdown">
        <summary class="btn btn--success add-dropdown__summary">
          Add item
          <span class="material-icons add-dropdown__chevron" aria-hidden="true">expand_more</span>
        </summary>
        <div class="add-dropdown__menu">
          <button type="button" class="add-dropdown__option" data-add-type="custom">
            <span class="add-dropdown__option-title">Custom text</span>
            <span class="add-dropdown__option-desc">Manual ticker message</span>
          </button>
          <button type="button" class="add-dropdown__option add-dropdown__option--acrally" data-add-type="acrally">
            <span class="add-dropdown__option-title">AC Rally</span>
            <span class="add-dropdown__option-desc">Stage and rank display</span>
          </button>
          <button type="button" class="add-dropdown__option add-dropdown__option--music" data-add-type="music">
            <span class="add-dropdown__option-title">Now Playing</span>
            <span class="add-dropdown__option-desc">Spotify sync</span>
          </button>
          <button type="button" class="add-dropdown__option add-dropdown__option--twitch" data-add-type="stream-title">
            <span class="add-dropdown__option-title">Stream Title</span>
            <span class="add-dropdown__option-desc">Twitch sync</span>
          </button>
        </div>
      </details>
    </div>
  `;
}

function renderItemToolbarMarkup(item: TickerItem): string {
  return `
    <div class="item-card__toolbar">
      <label class="switch" title="Active" aria-label="Toggle active">
        <input type="checkbox" class="toggle-active" ${item.active ? "checked" : ""} />
        <span class="switch__track"></span>
      </label>
      <button type="button" class="btn btn--icon-action edit-btn" aria-label="Edit" title="Edit">
        <span class="material-icons" aria-hidden="true">edit</span>
      </button>
      <button type="button" class="btn btn--icon-action btn--icon-action--danger delete-btn" aria-label="Delete" title="Delete">
        <span class="material-icons" aria-hidden="true">delete_outline</span>
      </button>
    </div>
  `;
}

function renderItemCardHeader(
  item: TickerItem,
  chipHtml: string | null = null,
  metaParts: string[] = []
): string {
  const metaHtml = metaParts.length > 0 ? renderItemMeta(metaParts) : "";

  return `
    <div class="item-card__header">
      <div class="item-card__header-main">
        ${chipHtml ? `<div class="item-card__chips">${chipHtml}</div>` : ""}
        ${metaHtml}
      </div>
      <div class="item-card__actions">${renderItemToolbarMarkup(item)}</div>
    </div>
  `;
}

function renderItemMeta(parts: string[]): string {
  return `<div class="item-card__meta">${parts.join(" · ")}</div>`;
}

function updateAcrallyAddPreview(): void {
  const stageSelect = document.getElementById("acrally-stage") as HTMLSelectElement | null;
  const rankInput = document.getElementById("acrally-rank") as HTMLInputElement | null;
  const previewEl = document.getElementById("acrally-add-preview");

  if (!stageSelect || !rankInput || !previewEl) return;

  const rank = rankInput.value.trim();
  if (!rank) {
    previewEl.innerHTML = '<span class="preview-placeholder">Preview appears here…</span>';
    return;
  }

  const text = formatAcrallyText(stageSelect.value, rank);
  previewEl.innerHTML = `<span class="ticker-preview-text">${renderHighlights(text)}</span>`;
}

function renderSettingsModalMarkup(): string {
  if (!showSettingsModal) return "";

  return `
    <div class="settings-modal" id="settings-modal">
      <button type="button" class="settings-modal__backdrop" id="settings-modal-backdrop" aria-label="Close settings"></button>
      <div class="settings-modal__panel" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <h2 id="settings-modal-title">Settings</h2>
        <div class="form-group">
          <label for="accent-color-hex">Accent color</label>
          <div class="settings-color-row">
            <input type="color" id="accent-color-picker" value="${escapeHtml(tickerAccentColor)}" />
            <input
              type="text"
              id="accent-color-hex"
              value="${escapeHtml(tickerAccentColor)}"
              placeholder="#ff5b20"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
          <p class="syntax-help">Used for <code>**accent**</code> highlights in ticker text.</p>
          <div class="preview-box settings-accent-preview" id="settings-accent-preview">
            <span class="ticker-preview-text">${renderHighlights("**Accent preview** on your ticker")}</span>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" id="settings-save-btn" class="btn btn--primary">Save</button>
          <button type="button" id="settings-cancel-btn" class="btn btn--ghost">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function bindSettingsModal(): void {
  if (!showSettingsModal) return;

  const picker = document.getElementById("accent-color-picker") as HTMLInputElement | null;
  const hexInput = document.getElementById("accent-color-hex") as HTMLInputElement | null;

  const closeSettings = (): void => {
    showSettingsModal = false;
    applyTickerAccent(tickerAccentColor);
    renderDashboard();
  };

  const syncAccentInputs = (hex: string): void => {
    const normalized = normalizeHexColor(hex);
    if (!normalized || !picker || !hexInput) return;

    picker.value = normalized;
    hexInput.value = normalized;
    applyTickerAccent(normalized);
  };

  if (picker) {
    picker.addEventListener("input", () => syncAccentInputs(picker.value));
  }

  if (hexInput) {
    hexInput.addEventListener("input", () => syncAccentInputs(hexInput.value));
  }

  document.getElementById("settings-modal-backdrop")?.addEventListener("click", closeSettings);
  document.getElementById("settings-cancel-btn")?.addEventListener("click", closeSettings);

  document.getElementById("settings-save-btn")?.addEventListener("click", async () => {
    const hex = hexInput?.value ?? tickerAccentColor;
    const saved = await saveTickerAccent(hex);

    if (!saved) {
      alert("Enter a valid hex color (e.g. #ff5b20).");
      return;
    }

    tickerAccentColor = saved;
    showSettingsModal = false;
    renderDashboard();
  });
}

function renderDashboard(): void {
  stopSpotifyPoller();
  stopTwitchPoller();

  app.innerHTML = `
    <header class="admin-header">
      <h1>Ticker Admin</h1>
      <div class="admin-header__actions">
        ${renderSpotifyStatusMarkup()}
        ${renderTwitchStatusMarkup()}
        <button type="button" id="settings-btn" class="btn btn--icon-action" aria-label="Settings" title="Settings">
          <span class="material-icons" aria-hidden="true">settings</span>
        </button>
        <button id="logout-btn" class="btn btn--ghost">Admin sign out</button>
      </div>
    </header>

    ${renderSettingsModalMarkup()}

    <section class="items-section">
      <div class="section-header">
        <h2>Ticker Items (${items.length})</h2>
        ${renderSectionHeaderActions()}
      </div>

      <section class="add-form" id="add-form-section" ${showAddForm ? "" : "hidden"}>
        <h2>Add Ticker Item</h2>
        <form id="add-form">
          <div class="form-group">
            <label for="new-text">Text</label>
            <textarea id="new-text" placeholder="**!livery** in chat for the newest i20 Livery" required></textarea>
            <p class="syntax-help">
              Markdown-style highlights:
              <code>**color accent**</code> &nbsp;
              <code>*bold*</code> &nbsp;
              <code>'italic'</code>
            </p>
            <div class="preview-box" id="add-preview"></div>
          </div>
          <div class="form-group">
            <label for="new-hold">Display time</label>
            ${renderHoldSelect("new-hold")}
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary">Save Item</button>
            <button type="button" id="cancel-add-btn" class="btn btn--ghost">Cancel</button>
          </div>
        </form>
      </section>

      <section class="add-form add-form--acrally" id="add-acrally-form-section" ${showAddAcrallyForm ? "" : "hidden"}>
        <h2>Add AC Rally Item</h2>
        <form id="add-acrally-form">
          <div class="form-group">
            <label for="acrally-stage">Current stage</label>
            ${renderStageSelect("acrally-stage", getDefaultAcrallyStage())}
          </div>
          <div class="form-group">
            <label for="acrally-rank">Current rank</label>
            <input type="text" id="acrally-rank" placeholder="1" required />
          </div>
          <div class="preview-box" id="acrally-add-preview">
            <span class="preview-placeholder">Preview appears here…</span>
          </div>
          <div class="form-group">
            <label for="acrally-hold">Display time</label>
            ${renderHoldSelect("acrally-hold")}
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn--acrally">Save AC Rally Item</button>
            <button type="button" id="cancel-add-acrally-btn" class="btn btn--ghost">Cancel</button>
          </div>
        </form>
      </section>

      ${items.length === 0 && !showAddForm && !showAddAcrallyForm ? '<div class="empty-state">No items yet. Use <strong>Add item</strong> to create your first ticker message.</div>' : ""}
      <ul class="item-list" id="item-list">
        ${items.map((item, index) => renderItemCard(item, index)).join("")}
      </ul>

      <p class="syntax-help syntax-help--footer">
        Markdown-style highlights:
        <code>**color accent**</code> &nbsp;
        <code>*bold*</code> &nbsp;
        <code>'italic'</code>
      </p>
    </section>
  `;

  document.getElementById("logout-btn")!.addEventListener("click", handleLogout);

  document.getElementById("settings-btn")?.addEventListener("click", () => {
    showSettingsModal = true;
    renderDashboard();
  });

  bindSettingsModal();

  const spotifyConnectBtn = document.getElementById("spotify-connect-btn");
  if (spotifyConnectBtn) {
    spotifyConnectBtn.addEventListener("click", () => {
      startSpotifyAuth();
    });
  }

  const spotifyDisconnectBtn = document.getElementById("spotify-disconnect-btn");
  if (spotifyDisconnectBtn) {
    spotifyDisconnectBtn.addEventListener("click", () => {
      disconnectSpotify();
    });
  }

  const twitchConnectBtn = document.getElementById("twitch-connect-btn");
  if (twitchConnectBtn) {
    twitchConnectBtn.addEventListener("click", () => {
      startTwitchDeviceConnect();
    });
  }

  const twitchCancelDeviceBtn = document.getElementById("twitch-cancel-device-btn");
  if (twitchCancelDeviceBtn) {
    twitchCancelDeviceBtn.addEventListener("click", () => {
      cancelTwitchDeviceConnect();
    });
  }

  const twitchDisconnectBtn = document.getElementById("twitch-disconnect-btn");
  if (twitchDisconnectBtn) {
    twitchDisconnectBtn.addEventListener("click", () => {
      disconnectTwitch();
    });
  }

  const addDropdown = document.getElementById("add-dropdown") as HTMLDetailsElement | null;
  if (addDropdown) {
    addDropdown.querySelectorAll("[data-add-type]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        addDropdown.open = false;
        const type = btn.getAttribute("data-add-type");

        if (type === "custom") {
          showAddForm = true;
          showAddAcrallyForm = false;
          renderDashboard();
          (document.getElementById("new-text") as HTMLTextAreaElement | null)?.focus();
          return;
        }

        if (type === "acrally") {
          showAddAcrallyForm = true;
          showAddForm = false;
          renderDashboard();
          (document.getElementById("acrally-rank") as HTMLInputElement | null)?.focus();
          return;
        }

        if (type === "music") {
          await addMusicItem(DEFAULT_HOLD_SECONDS);
          return;
        }

        if (type === "stream-title") {
          await addStreamTitleItem(DEFAULT_HOLD_SECONDS);
        }
      });
    });
  }

  const cancelAddBtn = document.getElementById("cancel-add-btn");
  if (cancelAddBtn) {
    cancelAddBtn.addEventListener("click", () => {
      showAddForm = false;
      renderDashboard();
    });
  }

  const cancelAddAcrallyBtn = document.getElementById("cancel-add-acrally-btn");
  if (cancelAddAcrallyBtn) {
    cancelAddAcrallyBtn.addEventListener("click", () => {
      showAddAcrallyForm = false;
      renderDashboard();
    });
  }

  const addForm = document.getElementById("add-form");
  if (addForm) {
    const newTextEl = document.getElementById("new-text") as HTMLTextAreaElement;
    const addPreviewEl = document.getElementById("add-preview")!;

    newTextEl.addEventListener("input", () => {
      addPreviewEl.innerHTML = newTextEl.value
        ? `<span class="ticker-preview-text">${renderHighlights(newTextEl.value)}</span>`
        : '<span class="preview-placeholder">Preview appears here…</span>';
    });

    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = newTextEl.value.trim();
      if (!text) return;
      const holdSelect = document.getElementById("new-hold") as HTMLSelectElement;
      const hold_seconds = secondsFromPreset(holdSelect.value);
      await addItem(text, hold_seconds);
    });
  }

  const addAcrallyForm = document.getElementById("add-acrally-form");
  if (addAcrallyForm) {
    const stageSelect = document.getElementById("acrally-stage") as HTMLSelectElement;
    const rankInput = document.getElementById("acrally-rank") as HTMLInputElement;

    stageSelect.addEventListener("change", updateAcrallyAddPreview);
    rankInput.addEventListener("input", updateAcrallyAddPreview);

    addAcrallyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rank = rankInput.value.trim();
      if (!rank) return;
      const holdSelect = document.getElementById("acrally-hold") as HTMLSelectElement;
      const hold_seconds = secondsFromPreset(holdSelect.value);
      await addAcrallyItem(stageSelect.value, rank, hold_seconds);
    });
  }

  bindItemEvents();
  bindDragReorder();
  startSpotifyPoller();
  startTwitchPoller();
}

function renderItemCard(item: TickerItem, index: number): string {
  if (isAcrallyItem(item)) {
    return renderAcrallyItemCard(item, index);
  }

  if (isMusicItem(item)) {
    return renderMusicItemCard(item, index);
  }

  if (isStreamTitleItem(item)) {
    return renderStreamTitleItemCard(item, index);
  }

  return `
    <li class="item-card ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        ${renderItemCardHeader(item, null, [formatHoldLabel(item.hold_seconds)])}
        <div class="item-card__preview">
          <div class="ticker-preview-text" id="text-${item.id}">${renderHighlights(getItemDisplayText(item))}</div>
        </div>
      </div>
    </li>
  `;
}

function renderAcrallyItemCard(item: TickerItem, index: number): string {
  const stage = item.acrally_stage ?? getDefaultAcrallyStage();
  const rank = item.acrally_rank ?? "";

  return `
    <li class="item-card item-card--acrally ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        ${renderItemCardHeader(item, `<span class="badge badge--acrally">AC Rally Mode</span>`, [formatHoldLabel(item.hold_seconds)])}
        <div class="item-card__preview">
          <div class="ticker-preview-text" id="text-${item.id}">${renderHighlights(getItemDisplayText(item))}</div>
        </div>
        <div class="item-card__acrally-quick">
          <div class="item-card__acrally-field">
            <label class="item-card__acrally-field-label" for="stage-${item.id}">Current stage</label>
            <select id="stage-${item.id}" class="acrally-stage-select" aria-label="Current stage">
              ${renderStageOptionsMarkup(stage)}
            </select>
            <span class="acrally-field-status" id="stage-status-${item.id}" hidden>Saved</span>
          </div>
          <div class="item-card__acrally-field">
            <label class="item-card__acrally-field-label" for="rank-${item.id}">Current rank</label>
            <input
              type="text"
              id="rank-${item.id}"
              class="acrally-rank-input"
              value="${escapeHtml(rank)}"
              aria-label="Current rank"
            />
            <span class="acrally-field-status" id="rank-status-${item.id}" hidden>Saved</span>
          </div>
        </div>
      </div>
    </li>
  `;
}

function renderMusicAlbumArtMarkup(item: TickerItem): string {
  const url = (item.music_album_art_url ?? "").trim();
  if (!url) return "";

  return `<img class="item-card__album-art" src="${escapeHtml(url)}" alt="" width="48" height="48" />`;
}

function renderMusicItemPreview(item: TickerItem): string {
  const labelHtml = renderHighlights(formatMusicLabel());
  const titleHtml = renderHighlights(
    formatMusicTitle(item.music_track ?? "", item.music_artist ?? "")
  );
  const artHtml = renderMusicAlbumArtMarkup(item);

  return `${labelHtml}${artHtml}${titleHtml}`;
}

function renderMusicItemCard(item: TickerItem, index: number): string {
  const spotifyReady = Boolean(spotifyTokens);
  const suppressed = musicAutoSyncSuppressedIds.has(item.id);
  const statusNote = spotifyReady
    ? suppressed
      ? "Paused for this session"
      : "Auto on when music plays"
    : "Connect Spotify to sync";

  return `
    <li class="item-card item-card--music ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        ${renderItemCardHeader(item, `<span class="badge badge--music">Now Playing</span>`, [
          statusNote,
          `Display: ${formatHoldLabel(item.hold_seconds)}`,
        ])}
        <div class="item-card__preview item-card__preview--music">
          <div class="item-card__music-preview-row ticker-preview-text" id="text-${item.id}">
            ${renderMusicItemPreview(item)}
          </div>
        </div>
      </div>
    </li>
  `;
}

function renderStreamTitleItemPreview(item: TickerItem): string {
  const titleHtml = renderHighlights(formatStreamTitleValue(item.twitch_stream_title ?? ""));
  return `${renderTwitchIconMarkup("item-card__twitch-icon")}${titleHtml}`;
}

function renderStreamTitleItemCard(item: TickerItem, index: number): string {
  const twitchReady = Boolean(twitchTokens);
  const statusNote = twitchReady ? "Syncs while admin is open" : "Connect Twitch to sync";

  return `
    <li class="item-card item-card--stream-title ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        ${renderItemCardHeader(item, `<span class="badge badge--twitch">Stream Title</span>`, [
          statusNote,
          `Display: ${formatHoldLabel(item.hold_seconds)}`,
        ])}
        <div class="item-card__preview item-card__preview--stream-title">
          <div class="item-card__stream-title-preview-row ticker-preview-text" id="text-${item.id}">
            ${renderStreamTitleItemPreview(item)}
          </div>
        </div>
      </div>
    </li>
  `;
}

function bindItemEvents(): void {
  document.querySelectorAll(".item-card").forEach((card) => {
    const id = (card as HTMLElement).dataset.id!;

    const deleteBtn = card.querySelector(".delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => deleteItem(id));
    }

    card.querySelector(".toggle-active")!.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      const item = items.find((i) => i.id === id);

      if (item && isMusicItem(item)) {
        if (checked) {
          musicAutoSyncSuppressedIds.delete(id);
        } else {
          musicAutoSyncSuppressedIds.add(id);
        }
      }

      updateItem(id, { active: checked });
    });

    const editBtn = card.querySelector(".edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", () => startEdit(id));
    }
  });

  bindAcrallyQuickFields();
}

function flashAcrallyFieldSaved(
  fieldEl: HTMLElement,
  statusEl: HTMLElement | null,
  savedClass: string
): void {
  if (!statusEl) return;
  statusEl.hidden = false;
  fieldEl.classList.add(savedClass);
  window.setTimeout(() => {
    statusEl.hidden = true;
    fieldEl.classList.remove(savedClass);
  }, 1200);
}

function bindAcrallyQuickFields(): void {
  document.querySelectorAll(".acrally-rank-input").forEach((input) => {
    const rankInput = input as HTMLInputElement;
    const id = rankInput.id.replace("rank-", "");
    const statusEl = document.getElementById(`rank-status-${id}`);

    const saveRank = async (): Promise<void> => {
      const saved = await updateAcrallyRank(id, rankInput.value);
      if (saved) flashAcrallyFieldSaved(rankInput, statusEl, "acrally-field--saved");
    };

    rankInput.addEventListener("blur", () => {
      saveRank();
    });

    rankInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        rankInput.blur();
      }
    });
  });

  document.querySelectorAll(".acrally-stage-select").forEach((select) => {
    const stageSelect = select as HTMLSelectElement;
    const id = stageSelect.id.replace("stage-", "");
    const statusEl = document.getElementById(`stage-status-${id}`);

    stageSelect.addEventListener("change", async () => {
      const saved = await updateAcrallyStage(id, stageSelect.value);
      if (saved) flashAcrallyFieldSaved(stageSelect, statusEl, "acrally-field--saved");
    });
  });
}

function bindDragReorder(): void {
  document.querySelectorAll(".item-card__drag-handle").forEach((handle) => {
    handle.addEventListener("dragstart", (e) => {
      const card = handle.closest(".item-card") as HTMLElement;
      draggedId = card.dataset.id!;
      card.classList.add("item-card--dragging");
      if (e instanceof DragEvent && e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
    });

    handle.addEventListener("dragend", () => {
      draggedId = null;
      document
        .querySelectorAll(".item-card--dragging, .item-card--drag-over")
        .forEach((el) => el.classList.remove("item-card--dragging", "item-card--drag-over"));
    });
  });

  document.querySelectorAll(".item-card").forEach((card) => {
    const el = card as HTMLElement;

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedId && el.dataset.id !== draggedId) {
        el.classList.add("item-card--drag-over");
      }
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("item-card--drag-over");
    });

    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("item-card--drag-over");
      if (!draggedId || el.dataset.id === draggedId) return;

      const fromIndex = items.findIndex((i) => i.id === draggedId);
      const toIndex = items.findIndex((i) => i.id === el.dataset.id);
      if (fromIndex === -1 || toIndex === -1) return;

      await reorderItems(fromIndex, toIndex);
    });
  });
}

function createHoldSelectElement(selectedSeconds?: number): HTMLSelectElement {
  const holdSelect = document.createElement("select");
  holdSelect.className = "item-card__hold";
  holdSelect.innerHTML = `
    <option value="default">Default (5s)</option>
    <option value="extended">Extended (10s)</option>
    <option value="super">Super (15s)</option>
  `;
  holdSelect.value = presetFromSeconds(selectedSeconds);
  return holdSelect;
}

function setCardEditActions(card: Element): void {
  card.querySelector(".item-card__actions")!.innerHTML = `
    <div class="item-card__toolbar item-card__toolbar--edit">
      <button type="button" class="btn btn--primary btn--sm save-edit">Save</button>
      <button type="button" class="btn btn--ghost btn--sm cancel-edit">Cancel</button>
    </div>
  `;
}

function startEdit(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  if (isMusicItem(item) || isStreamTitleItem(item)) {
    startHoldOnlyEdit(id, item);
    return;
  }

  if (isAcrallyItem(item)) {
    startAcrallyEdit(id, item);
    return;
  }

  const textEl = document.getElementById(`text-${id}`)!;
  const card = textEl.closest(".item-card")!;
  const previewWrap = textEl.closest(".item-card__preview")!;

  setCardEditActions(card);

  const textarea = document.createElement("textarea");
  textarea.className = "item-card__edit";
  textarea.value = item.text;

  const holdLabel = document.createElement("label");
  holdLabel.className = "item-card__hold-label";
  holdLabel.textContent = "Display time";

  const holdSelect = createHoldSelectElement(item.hold_seconds);

  const editFields = document.createElement("div");
  editFields.className = "item-card__edit-fields";
  editFields.append(textarea, holdLabel, holdSelect);

  previewWrap.replaceWith(editFields);
  textarea.focus();

  card.querySelector(".save-edit")!.addEventListener("click", async () => {
    const newText = textarea.value.trim();
    const hold_seconds = secondsFromPreset(holdSelect.value);
    if (newText) {
      await updateItem(id, { text: newText, hold_seconds });
    } else {
      renderDashboard();
    }
  });

  card.querySelector(".cancel-edit")!.addEventListener("click", () => renderDashboard());
}

function startHoldOnlyEdit(id: string, item: TickerItem): void {
  const card = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const body = card.querySelector(".item-card__body")!;
  const preview = body.querySelector(".item-card__preview");

  setCardEditActions(card);

  body.querySelector(".item-card__hold-edit")?.remove();

  const holdLabel = document.createElement("label");
  holdLabel.className = "item-card__hold-label";
  holdLabel.textContent = "Display time";

  const holdSelect = createHoldSelectElement(item.hold_seconds);

  const editFields = document.createElement("div");
  editFields.className = "item-card__edit-fields item-card__hold-edit";
  editFields.append(holdLabel, holdSelect);

  if (preview) {
    preview.after(editFields);
  } else {
    body.append(editFields);
  }

  holdSelect.focus();

  card.querySelector(".save-edit")!.addEventListener("click", async () => {
    const hold_seconds = secondsFromPreset(holdSelect.value);
    await updateItem(id, { hold_seconds });
  });

  card.querySelector(".cancel-edit")!.addEventListener("click", () => renderDashboard());
}

function startAcrallyEdit(id: string, item: TickerItem): void {
  const card = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const body = card.querySelector(".item-card__body")!;

  setCardEditActions(card);

  const holdLabel = document.createElement("label");
  holdLabel.className = "item-card__hold-label";
  holdLabel.textContent = "Display time";

  const holdSelect = createHoldSelectElement(item.hold_seconds);

  const editNote = document.createElement("p");
  editNote.className = "item-card__acrally-edit-note";
  editNote.textContent = "Stage and rank can be updated directly on the card.";

  const editFields = document.createElement("div");
  editFields.className = "item-card__edit-fields";
  editFields.append(editNote, holdLabel, holdSelect);

  body.innerHTML = "";
  body.append(editFields);
  holdSelect.focus();

  card.querySelector(".save-edit")!.addEventListener("click", async () => {
    const hold_seconds = secondsFromPreset(holdSelect.value);
    await updateItem(id, { hold_seconds });
  });

  card.querySelector(".cancel-edit")!.addEventListener("click", () => renderDashboard());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
