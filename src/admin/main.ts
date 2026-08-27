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
  getItemDisplayText,
  isAcrallyItem,
  isMusicItem,
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
import {
  clearSpotifyCallbackParams,
  exchangeSpotifyCode,
  fetchCurrentlyPlaying,
  isSpotifyConfigured,
  isSpotifyTokenExpired,
  parseSpotifyCallbackCode,
  refreshSpotifyAccessToken,
  spotifyExpiresAt,
  startSpotifyAuth,
} from "../lib/spotify";
import type { Session } from "@supabase/supabase-js";

interface SpotifyTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

const SPOTIFY_POLL_MS = 5000;

const app = document.getElementById("app")!;

let session: Session | null = null;
let items: TickerItem[] = [];
let showAddForm = false;
let showAddAcrallyForm = false;
let draggedId: string | null = null;
let spotifyTokens: SpotifyTokenRow | null = null;
let spotifyPollTimer: ReturnType<typeof setInterval> | null = null;

// --- Auth ---

async function init(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  session = data.session;

  if (session) {
    await handleSpotifyOAuthCallbackIfPresent();
    await loadItems();
    await loadSpotifyTokens();
  }

  render();

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    stopSpotifyPoller();
    if (newSession) {
      await loadItems();
      await loadSpotifyTokens();
    } else {
      spotifyTokens = null;
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

function hasActiveMusicItems(): boolean {
  return items.some((item) => isMusicItem(item) && item.active);
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
  if (!spotifyTokens || !hasActiveMusicItems()) return;

  const accessToken = await ensureSpotifyAccessToken();
  if (!accessToken) return;

  try {
    const nowPlaying = await fetchCurrentlyPlaying(accessToken);
    const track = nowPlaying?.track ?? "";
    const artist = nowPlaying?.artist ?? "";
    const albumArtUrl = nowPlaying?.albumArtUrl ?? "";

    for (const item of items) {
      if (!isMusicItem(item) || !item.active) continue;
      await updateMusicItemFields(item.id, track, artist, albumArtUrl);
    }
  } catch (error) {
    console.error("Spotify poll failed:", error);
  }
}

function startSpotifyPoller(): void {
  stopSpotifyPoller();

  if (!spotifyTokens || !hasActiveMusicItems()) return;

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
        <span class="spotify-panel__label">Spotify</span>
        <span class="spotify-panel__status">Add VITE_SPOTIFY_CLIENT_ID to enable</span>
      </div>
    `;
  }

  const connected = Boolean(spotifyTokens);
  const statusText = connected ? "Connected" : "Not connected";
  const buttonLabel = connected ? "Disconnect Spotify" : "Connect Spotify";
  const buttonId = connected ? "spotify-disconnect-btn" : "spotify-connect-btn";

  return `
    <div class="spotify-panel ${connected ? "spotify-panel--connected" : ""}">
      <span class="spotify-panel__label">Spotify</span>
      <span class="spotify-panel__status">${statusText}</span>
      <button type="button" id="${buttonId}" class="btn btn--sm ${connected ? "btn--ghost" : "btn--music"}">${buttonLabel}</button>
    </div>
  `;
}

async function deleteItem(id: string): Promise<void> {
  if (!confirm("Delete this ticker item?")) return;

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

function renderAddFormButtons(): string {
  if (showAddForm || showAddAcrallyForm) return "";

  return `
    <div class="section-header__actions">
      <button type="button" id="show-add-btn" class="btn btn--success">Add Item</button>
      <button type="button" id="show-add-acrally-btn" class="btn btn--acrally">Add AC Rally Item</button>
      <button type="button" id="show-add-music-btn" class="btn btn--music">Add Music Item</button>
    </div>
  `;
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

function renderDashboard(): void {
  stopSpotifyPoller();

  app.innerHTML = `
    <header class="admin-header">
      <h1>Ticker Admin</h1>
      <div class="admin-header__actions">
        ${renderSpotifyStatusMarkup()}
        <a href="/overlay.html" target="_blank" rel="noopener noreferrer" class="btn btn--secondary">Preview Overlay</a>
        <button id="logout-btn" class="btn btn--ghost">Sign Out</button>
      </div>
    </header>

    <section class="items-section">
      <div class="section-header">
        <h2>Ticker Items (${items.length})</h2>
        ${renderAddFormButtons()}
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

      ${items.length === 0 && !showAddForm && !showAddAcrallyForm ? '<div class="empty-state">No items yet. Click Add Item, Add AC Rally Item, or Add Music Item to get started.</div>' : ""}
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

  const showAddBtn = document.getElementById("show-add-btn");
  if (showAddBtn) {
    showAddBtn.addEventListener("click", () => {
      showAddForm = true;
      showAddAcrallyForm = false;
      renderDashboard();
      (document.getElementById("new-text") as HTMLTextAreaElement | null)?.focus();
    });
  }

  const showAddAcrallyBtn = document.getElementById("show-add-acrally-btn");
  if (showAddAcrallyBtn) {
    showAddAcrallyBtn.addEventListener("click", () => {
      showAddAcrallyForm = true;
      showAddForm = false;
      renderDashboard();
      (document.getElementById("acrally-rank") as HTMLInputElement | null)?.focus();
    });
  }

  const showAddMusicBtn = document.getElementById("show-add-music-btn");
  if (showAddMusicBtn) {
    showAddMusicBtn.addEventListener("click", async () => {
      await addMusicItem(DEFAULT_HOLD_SECONDS);
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
}

function renderItemCard(item: TickerItem, index: number): string {
  if (isAcrallyItem(item)) {
    return renderAcrallyItemCard(item, index);
  }

  if (isMusicItem(item)) {
    return renderMusicItemCard(item, index);
  }

  return `
    <li class="item-card ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        <div class="item-card__preview">
          <div class="ticker-preview-text" id="text-${item.id}">${renderHighlights(getItemDisplayText(item))}</div>
        </div>
        <div class="item-card__meta">Display: ${formatHoldLabel(item.hold_seconds)} · ${item.active ? "Active" : "Inactive"}</div>
      </div>
      <div class="item-card__actions">
        <label class="toggle toggle--active">
          <input type="checkbox" class="toggle-active" ${item.active ? "checked" : ""} />
          <span>Active</span>
        </label>
        <div class="item-card__action-buttons">
          <button type="button" class="btn btn--secondary btn--sm edit-btn">Edit</button>
          <button type="button" class="btn btn--danger btn--sm delete-btn">Delete</button>
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
        <div class="item-card__acrally-header">
          <span class="badge badge--acrally">AC Rally Mode</span>
        </div>
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
        <div class="item-card__meta item-card__meta--acrally">
          Display: ${formatHoldLabel(item.hold_seconds)} · ${item.active ? "Active" : "Inactive"}
        </div>
      </div>
      <div class="item-card__actions">
        <label class="toggle toggle--active">
          <input type="checkbox" class="toggle-active" ${item.active ? "checked" : ""} />
          <span>Active</span>
        </label>
        <div class="item-card__action-buttons">
          <button type="button" class="btn btn--secondary btn--sm edit-btn">Edit</button>
          <button type="button" class="btn btn--danger btn--sm delete-btn">Delete</button>
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
  const statusNote = spotifyReady
    ? "Updates while this admin tab is open"
    : "Connect Spotify above to sync now playing";

  return `
    <li class="item-card item-card--music ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        <div class="item-card__music-header">
          <span class="badge badge--music">Now Playing</span>
        </div>
        <div class="item-card__preview item-card__preview--music">
          <div class="item-card__music-preview-row ticker-preview-text" id="text-${item.id}">
            ${renderMusicItemPreview(item)}
          </div>
        </div>
        <div class="item-card__meta item-card__meta--music">
          ${statusNote} · Display: ${formatHoldLabel(item.hold_seconds)} · ${item.active ? "Active" : "Inactive"}
        </div>
      </div>
      <div class="item-card__actions">
        <label class="toggle toggle--active">
          <input type="checkbox" class="toggle-active" ${item.active ? "checked" : ""} />
          <span>Active</span>
        </label>
        <div class="item-card__action-buttons">
          <button type="button" class="btn btn--danger btn--sm delete-btn">Delete</button>
        </div>
      </div>
    </li>
  `;
}

function bindItemEvents(): void {
  document.querySelectorAll(".item-card").forEach((card) => {
    const id = (card as HTMLElement).dataset.id!;

    card.querySelector(".delete-btn")!.addEventListener("click", () => deleteItem(id));

    card.querySelector(".toggle-active")!.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
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

function startEdit(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  if (isMusicItem(item)) return;

  if (isAcrallyItem(item)) {
    startAcrallyEdit(id, item);
    return;
  }

  const textEl = document.getElementById(`text-${id}`)!;
  const card = textEl.closest(".item-card")!;
  const previewWrap = textEl.closest(".item-card__preview")!;

  card.querySelector(".item-card__actions")!.innerHTML = `
    <div class="item-card__action-buttons item-card__action-buttons--edit">
      <button type="button" class="btn btn--primary btn--sm save-edit">Save</button>
      <button type="button" class="btn btn--ghost btn--sm cancel-edit">Cancel</button>
    </div>
  `;

  const textarea = document.createElement("textarea");
  textarea.className = "item-card__edit";
  textarea.value = item.text;

  const holdLabel = document.createElement("label");
  holdLabel.className = "item-card__hold-label";
  holdLabel.textContent = "Display time";

  const holdSelect = document.createElement("select");
  holdSelect.className = "item-card__hold";
  holdSelect.innerHTML = `
    <option value="default">Default (5s)</option>
    <option value="extended">Extended (10s)</option>
    <option value="super">Super (15s)</option>
  `;
  holdSelect.value = presetFromSeconds(item.hold_seconds);

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

function startAcrallyEdit(id: string, item: TickerItem): void {
  const card = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const body = card.querySelector(".item-card__body")!;

  card.querySelector(".item-card__actions")!.innerHTML = `
    <div class="item-card__action-buttons item-card__action-buttons--edit">
      <button type="button" class="btn btn--primary btn--sm save-edit">Save</button>
      <button type="button" class="btn btn--ghost btn--sm cancel-edit">Cancel</button>
    </div>
  `;

  const holdLabel = document.createElement("label");
  holdLabel.className = "item-card__hold-label";
  holdLabel.textContent = "Display time";

  const holdSelect = document.createElement("select");
  holdSelect.className = "item-card__hold";
  holdSelect.innerHTML = `
    <option value="default">Default (5s)</option>
    <option value="extended">Extended (10s)</option>
    <option value="super">Super (15s)</option>
  `;
  holdSelect.value = presetFromSeconds(item.hold_seconds);

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
