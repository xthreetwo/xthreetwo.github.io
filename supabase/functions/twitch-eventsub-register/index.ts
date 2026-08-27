import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { EVENTSUB_SUBSCRIPTIONS } from "../_shared/twitchAlerts.ts";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_API_BASE = "https://api.twitch.tv/helix";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface TwitchTokenRow {
  user_id: string;
  broadcaster_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
} | null> {
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
    console.error("Token refresh failed:", await res.text());
    return null;
  }

  return res.json();
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now() + 60_000;
}

async function ensureAccessToken(
  supabase: ReturnType<typeof createClient>,
  row: TwitchTokenRow
): Promise<string | null> {
  if (!isExpired(row.expires_at)) {
    return row.access_token;
  }

  const refreshed = await refreshAccessToken(row.refresh_token);
  if (!refreshed) return null;

  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const refreshToken = refreshed.refresh_token ?? row.refresh_token;

  const { error } = await supabase
    .from("twitch_tokens")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    })
    .eq("user_id", row.user_id);

  if (error) {
    console.error("Failed to save refreshed token:", error.message);
    return null;
  }

  return refreshed.access_token;
}

async function listSubscriptions(accessToken: string): Promise<Array<{ id: string }>> {
  const res = await fetch(`${TWITCH_API_BASE}/eventsub/subscriptions`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": TWITCH_CLIENT_ID,
    },
  });

  if (!res.ok) {
    console.error("List subscriptions failed:", await res.text());
    return [];
  }

  const data = await res.json();
  return (data?.data ?? []).map((sub: { id: string }) => ({ id: sub.id }));
}

async function deleteSubscription(accessToken: string, subscriptionId: string): Promise<void> {
  const params = new URLSearchParams({ id: subscriptionId });
  const res = await fetch(`${TWITCH_API_BASE}/eventsub/subscriptions?${params}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": TWITCH_CLIENT_ID,
    },
  });

  if (!res.ok) {
    console.error("Delete subscription failed:", subscriptionId, await res.text());
  }
}

async function createSubscription(
  accessToken: string,
  callbackUrl: string,
  broadcasterId: string,
  type: string,
  version: string,
  conditionKey: "broadcaster_user_id" | "to_broadcaster_user_id"
): Promise<string | null> {
  const condition =
    conditionKey === "to_broadcaster_user_id"
      ? { to_broadcaster_user_id: broadcasterId }
      : { broadcaster_user_id: broadcasterId };

  const res = await fetch(`${TWITCH_API_BASE}/eventsub/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": TWITCH_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type,
      version,
      condition,
      transport: {
        method: "webhook",
        callback: callbackUrl,
        secret: Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? "",
      },
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    console.error("Create subscription failed:", type, data);
    return null;
  }

  return data?.data?.[0]?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = userData.user.id;
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: tokenRow, error: tokenError } = await serviceClient
    .from("twitch_tokens")
    .select("user_id, broadcaster_id, access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (tokenError || !tokenRow) {
    return new Response(JSON.stringify({ error: "Twitch not connected" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accessToken = await ensureAccessToken(serviceClient, tokenRow as TwitchTokenRow);
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Twitch token refresh failed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const callbackUrl = `${SUPABASE_URL}/functions/v1/twitch-eventsub`;
  const broadcasterId = tokenRow.broadcaster_id as string;

  const existing = await listSubscriptions(accessToken);
  for (const sub of existing) {
    await deleteSubscription(accessToken, sub.id);
  }

  await serviceClient.from("twitch_event_subscriptions").delete().eq("user_id", userId);

  const created: string[] = [];
  const failed: string[] = [];

  for (const sub of EVENTSUB_SUBSCRIPTIONS) {
    const subscriptionId = await createSubscription(
      accessToken,
      callbackUrl,
      broadcasterId,
      sub.type,
      sub.version,
      sub.conditionKey
    );

    if (subscriptionId) {
      created.push(sub.type);
      await serviceClient.from("twitch_event_subscriptions").insert({
        user_id: userId,
        subscription_id: subscriptionId,
        subscription_type: sub.type,
        status: "enabled",
      });
    } else {
      failed.push(sub.type);
    }
  }

  return new Response(
    JSON.stringify({
      ok: failed.length === 0,
      created,
      failed,
      callbackUrl,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
