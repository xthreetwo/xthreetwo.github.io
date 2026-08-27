import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";

const TWITCH_CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID;
const TWITCH_DEVICE_URL = "https://id.twitch.tv/oauth2/device";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_API_BASE = "https://api.twitch.tv/helix";

async function callTwitchOAuthEdge(
  body: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twitch-oauth`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    return res.json().catch(() => null);
  } catch (error) {
    console.error("Twitch OAuth edge call failed:", error);
    return null;
  }
}

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

  const edgeResult = await callTwitchOAuthEdge({
    action: "device_poll",
    device_code: deviceCode,
  });

  if (edgeResult) {
    if (edgeResult.status === "success" && edgeResult.tokens) {
      return {
        status: "success",
        tokens: edgeResult.tokens as TwitchTokenResponse,
      };
    }

    if (edgeResult.status === "pending") {
      return { status: "pending" };
    }

    if (edgeResult.status === "slow_down") {
      return { status: "slow_down" };
    }

    const edgeMessage =
      typeof edgeResult.message === "string"
        ? edgeResult.message
        : typeof edgeResult.error === "string"
          ? edgeResult.error
          : "Twitch authorization failed.";

    return { status: "error", message: edgeMessage };
  }

  return {
    status: "error",
    message: "Could not reach twitch-oauth Edge Function. Deploy it and set TWITCH_CLIENT_SECRET.",
  };
}

export async function refreshTwitchAccessToken(
  refreshToken: string
): Promise<TwitchTokenResponse | null> {
  if (!TWITCH_CLIENT_ID) return null;

  const edgeResult = await callTwitchOAuthEdge({
    action: "refresh",
    refresh_token: refreshToken,
  });

  if (edgeResult?.ok && edgeResult.tokens) {
    return edgeResult.tokens as TwitchTokenResponse;
  }

  console.error("Twitch token refresh failed:", edgeResult?.error ?? "edge call failed");
  return null;
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
