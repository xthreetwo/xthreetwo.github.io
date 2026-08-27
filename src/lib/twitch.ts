const TWITCH_CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID;
const TWITCH_DEVICE_URL = "https://id.twitch.tv/oauth2/device";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_API_BASE = "https://api.twitch.tv/helix";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

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

export interface TwitchDeviceCodeResponse {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
}

export type TwitchDevicePollStatus = "pending" | "slow_down" | "success" | "error";

export interface TwitchDevicePollResult {
  status: TwitchDevicePollStatus;
  tokens?: TwitchTokenResponse;
  message?: string;
}

export function isTwitchConfigured(): boolean {
  return Boolean(TWITCH_CLIENT_ID);
}

function twitchDeviceScopes(): string {
  return [
    "moderator:read:followers",
    "channel:read:subscriptions",
    "bits:read",
  ].join(" ");
}

export function twitchRequiredScopes(): string[] {
  return twitchDeviceScopes().split(" ").filter(Boolean);
}

export function twitchHasRequiredScopes(scopes: string | null | undefined): boolean {
  const granted = (scopes ?? "").split(/\s+/).filter(Boolean);
  return twitchRequiredScopes().every((scope) => granted.includes(scope));
}

export async function requestTwitchDeviceCode(): Promise<TwitchDeviceCodeResponse | null> {
  if (!TWITCH_CLIENT_ID) return null;

  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    scopes: twitchDeviceScopes(),
  });

  const res = await fetch(TWITCH_DEVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Twitch device code request failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

export async function pollTwitchDeviceToken(
  deviceCode: string
): Promise<TwitchDevicePollResult> {
  if (!TWITCH_CLIENT_ID) {
    return { status: "error", message: "Twitch Client ID is not configured." };
  }

  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    scopes: twitchDeviceScopes(),
    device_code: deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
  });

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (res.ok) {
    const tokens = (await res.json()) as TwitchTokenResponse;
    return { status: "success", tokens };
  }

  const errorBody = await res.json().catch(() => null);
  const errorMessage = typeof errorBody?.message === "string" ? errorBody.message : "";

  if (errorMessage === "authorization_pending") {
    return { status: "pending" };
  }

  if (errorMessage === "slow_down") {
    return { status: "slow_down" };
  }

  console.error("Twitch device token poll failed:", res.status, errorBody);
  return {
    status: "error",
    message: errorMessage || "Twitch authorization failed.",
  };
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
