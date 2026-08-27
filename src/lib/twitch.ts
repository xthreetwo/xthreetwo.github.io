const TWITCH_CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID;
const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_API_BASE = "https://api.twitch.tv/helix";
const PKCE_STORAGE_KEY = "twitch_pkce_verifier";
const OAUTH_STATE = "twitch";

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface TwitchValidateResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
}

export function isTwitchConfigured(): boolean {
  return Boolean(TWITCH_CLIENT_ID);
}

/** Must match a redirect URI registered in the Twitch Developer Console. */
const TWITCH_REDIRECT_PATH = "/admin.html";

export function getTwitchRedirectUri(): string {
  return `${window.location.origin}${TWITCH_REDIRECT_PATH}`;
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

export async function startTwitchAuth(): Promise<void> {
  if (!TWITCH_CLIENT_ID) {
    alert("Twitch Client ID is not configured. Add VITE_TWITCH_CLIENT_ID to your environment.");
    return;
  }

  const verifier = randomString(64);
  sessionStorage.setItem(PKCE_STORAGE_KEY, verifier);
  const challenge = base64UrlEncode(await sha256(verifier));

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    response_type: "code",
    redirect_uri: getTwitchRedirectUri(),
    state: OAUTH_STATE,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `${TWITCH_AUTH_URL}?${params}`;
}

export async function exchangeTwitchCode(code: string): Promise<TwitchTokenResponse | null> {
  const verifier = sessionStorage.getItem(PKCE_STORAGE_KEY);
  if (!verifier || !TWITCH_CLIENT_ID) return null;

  sessionStorage.removeItem(PKCE_STORAGE_KEY);

  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: getTwitchRedirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Twitch token exchange failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

export async function refreshTwitchAccessToken(
  refreshToken: string
): Promise<TwitchTokenResponse | null> {
  if (!TWITCH_CLIENT_ID) return null;

  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Twitch token refresh failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

export async function validateTwitchToken(accessToken: string): Promise<TwitchValidateResponse | null> {
  const res = await fetch(TWITCH_VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });

  if (!res.ok) {
    console.error("Twitch token validation failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

export async function fetchChannelTitle(
  accessToken: string,
  broadcasterId: string
): Promise<string | null> {
  const params = new URLSearchParams({ broadcaster_id: broadcasterId });
  const res = await fetch(`${TWITCH_API_BASE}/channels?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": TWITCH_CLIENT_ID ?? "",
    },
  });

  if (!res.ok) {
    throw new Error(`Twitch API error: ${res.status}`);
  }

  const data = await res.json();
  const channel = data?.data?.[0];
  if (!channel) return null;

  return channel.title?.trim() ?? "";
}

export function twitchExpiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export function isTwitchTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now() + 60_000;
}

export function isTwitchOAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("state") === OAUTH_STATE && params.has("code");
}

export function parseTwitchCallbackCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("state") !== OAUTH_STATE) return null;

  const code = params.get("code");
  const error = params.get("error");

  if (error) {
    console.error("Twitch auth error:", error);
    return null;
  }

  return code;
}

export function clearTwitchCallbackParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  window.history.replaceState({}, document.title, url.pathname + url.search);
}
