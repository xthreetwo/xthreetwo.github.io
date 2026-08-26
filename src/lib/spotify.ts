const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const PKCE_STORAGE_KEY = "spotify_pkce_verifier";

export interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface NowPlaying {
  track: string;
  artist: string;
}

export function isSpotifyConfigured(): boolean {
  return Boolean(SPOTIFY_CLIENT_ID);
}

export function getSpotifyRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) {
    str += String.fromCharCode(b);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

export async function startSpotifyAuth(): Promise<void> {
  if (!SPOTIFY_CLIENT_ID) {
    alert("Spotify Client ID is not configured. Add VITE_SPOTIFY_CLIENT_ID to your environment.");
    return;
  }

  const verifier = randomString(64);
  sessionStorage.setItem(PKCE_STORAGE_KEY, verifier);
  const challenge = base64UrlEncode(await sha256(verifier));

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: getSpotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `${SPOTIFY_AUTH_URL}?${params}`;
}

export async function exchangeSpotifyCode(code: string): Promise<SpotifyTokenResponse | null> {
  const verifier = sessionStorage.getItem(PKCE_STORAGE_KEY);
  if (!verifier || !SPOTIFY_CLIENT_ID) return null;

  sessionStorage.removeItem(PKCE_STORAGE_KEY);

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: getSpotifyRedirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Spotify token exchange failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

export async function refreshSpotifyAccessToken(
  refreshToken: string
): Promise<SpotifyTokenResponse | null> {
  if (!SPOTIFY_CLIENT_ID) return null;

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Spotify token refresh failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

export async function fetchCurrentlyPlaying(accessToken: string): Promise<NowPlaying | null> {
  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    throw new Error(`Spotify API error: ${res.status}`);
  }

  const data = await res.json();
  const item = data?.item;

  if (!item || data.currently_playing_type !== "track") return null;

  const track = item.name?.trim() ?? "";
  const artist =
    item.artists?.map((a: { name: string }) => a.name).join(", ").trim() ?? "";

  if (!track) return null;

  return { track, artist };
}

export function spotifyExpiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export function isSpotifyTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now() + 60_000;
}

export function parseSpotifyCallbackCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");

  if (error) {
    console.error("Spotify auth error:", error);
    return null;
  }

  return code;
}

export function clearSpotifyCallbackParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  window.history.replaceState({}, document.title, url.pathname + url.search);
}
