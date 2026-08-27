export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export function twitchClientId(): string {
  return Deno.env.get("TWITCH_CLIENT_ID") ?? "";
}

export function twitchClientSecret(): string {
  return Deno.env.get("TWITCH_CLIENT_SECRET") ?? "";
}

export function hasTwitchClientSecret(): boolean {
  return Boolean(twitchClientId() && twitchClientSecret());
}

export async function getAppAccessToken(): Promise<string | null> {
  const clientId = twitchClientId();
  const clientSecret = twitchClientSecret();
  if (!clientId || !clientSecret) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("App access token failed:", await res.text());
    return null;
  }

  const data = await res.json();
  return typeof data?.access_token === "string" ? data.access_token : null;
}

export async function refreshUserAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
} | null> {
  const clientId = twitchClientId();
  const clientSecret = twitchClientSecret();
  if (!clientId || !clientSecret) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("User token refresh failed:", await res.text());
    return null;
  }

  return res.json();
}

export async function pollDeviceAccessToken(
  deviceCode: string,
  scopes: string
): Promise<{
  ok: boolean;
  status?: "pending" | "slow_down" | "success" | "error";
  tokens?: { access_token: string; refresh_token?: string; expires_in: number };
  message?: string;
}> {
  const clientId = twitchClientId();
  const clientSecret = twitchClientSecret();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: "error",
      message: "TWITCH_CLIENT_SECRET is not configured on the server.",
    };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    device_code: deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
    scopes,
  });

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (res.ok) {
    const tokens = await res.json();
    return { ok: true, status: "success", tokens };
  }

  const errorBody = await res.json().catch(() => null);
  const errorMessage = typeof errorBody?.message === "string" ? errorBody.message : "";

  if (errorMessage === "authorization_pending") {
    return { ok: true, status: "pending" };
  }

  if (errorMessage === "slow_down") {
    return { ok: true, status: "slow_down" };
  }

  console.error("Device token poll failed:", res.status, errorBody);
  return {
    ok: false,
    status: "error",
    message: errorMessage || "Twitch authorization failed.",
  };
}
