import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, jsonWithCors } from "../_shared/cors.ts";
import {
  hasTwitchClientSecret,
  pollDeviceAccessToken,
  refreshUserAccessToken,
  twitchClientId,
} from "../_shared/twitchOAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const TWITCH_DEVICE_SCOPES = [
  "moderator:read:followers",
  "channel:read:subscriptions",
  "bits:read",
].join(" ");

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return jsonWithCors(body, status);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!twitchClientId()) {
    return jsonResponse({ error: "TWITCH_CLIENT_ID secret is not set in Edge Functions" }, 500);
  }

  if (!hasTwitchClientSecret()) {
    return jsonResponse({
      error:
        "TWITCH_CLIENT_SECRET is not set. Switch your Twitch app to Confidential and add the client secret to Edge Function secrets.",
    }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => null);
  const action = typeof payload?.action === "string" ? payload.action : "";

  if (action === "device_poll") {
    const deviceCode = typeof payload?.device_code === "string" ? payload.device_code : "";
    if (!deviceCode) {
      return jsonResponse({ error: "device_code is required" }, 400);
    }

    const result = await pollDeviceAccessToken(deviceCode, TWITCH_DEVICE_SCOPES);
    return jsonResponse(result);
  }

  if (action === "refresh") {
    const refreshToken = typeof payload?.refresh_token === "string" ? payload.refresh_token : "";
    if (!refreshToken) {
      return jsonResponse({ error: "refresh_token is required" }, 400);
    }

    const tokens = await refreshUserAccessToken(refreshToken);
    if (!tokens) {
      return jsonResponse({ error: "Twitch token refresh failed" }, 400);
    }

    return jsonResponse({ ok: true, tokens });
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});
