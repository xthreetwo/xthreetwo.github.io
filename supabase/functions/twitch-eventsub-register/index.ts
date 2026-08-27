import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { EVENTSUB_SUBSCRIPTIONS } from "../_shared/twitchAlerts.ts";
import { handleCors, jsonWithCors } from "../_shared/cors.ts";
import { getAppAccessToken, hasTwitchClientSecret, twitchClientId } from "../_shared/twitchOAuth.ts";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
const TWITCH_EVENTSUB_SECRET = Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? "";
const TWITCH_API_BASE = "https://api.twitch.tv/helix";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface SubscriptionFailure {
  type: string;
  message: string;
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
  type: string,
  version: string,
  condition: Record<string, string>
): Promise<{ id: string | null; error: string | null }> {
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
        secret: TWITCH_EVENTSUB_SECRET,
      },
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const twitchMessage =
      data?.message ??
      data?.error ??
      (Array.isArray(data?.data) ? data.data[0]?.message : undefined) ??
      `HTTP ${res.status}`;
    console.error("Create subscription failed:", type, data);
    return { id: null, error: String(twitchMessage) };
  }

  return { id: data?.data?.[0]?.id ?? null, error: null };
}

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
        "TWITCH_CLIENT_SECRET is not set. Webhook EventSub requires a Confidential Twitch app — add the client secret to Edge Function secrets.",
    }, 500);
  }

  if (!TWITCH_EVENTSUB_SECRET) {
    return jsonResponse({ error: "TWITCH_EVENTSUB_SECRET secret is not set in Edge Functions" }, 500);
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

  const userId = userData.user.id;
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: tokenRow, error: tokenError } = await serviceClient
    .from("twitch_tokens")
    .select("user_id, broadcaster_id, scopes")
    .eq("user_id", userId)
    .maybeSingle();

  if (tokenError || !tokenRow) {
    return jsonResponse({ error: "Twitch not connected — connect Twitch first" }, 400);
  }

  const appAccessToken = await getAppAccessToken();
  if (!appAccessToken) {
    return jsonResponse({
      error: "Failed to get Twitch app access token — check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET",
    }, 500);
  }

  const callbackUrl = `${SUPABASE_URL}/functions/v1/twitch-eventsub`;
  const broadcasterId = tokenRow.broadcaster_id as string;

  const existing = await listSubscriptions(appAccessToken);
  for (const sub of existing) {
    await deleteSubscription(appAccessToken, sub.id);
  }

  await serviceClient.from("twitch_event_subscriptions").delete().eq("user_id", userId);

  const created: string[] = [];
  const failed: string[] = [];
  const failures: SubscriptionFailure[] = [];

  for (const sub of EVENTSUB_SUBSCRIPTIONS) {
    const condition = sub.buildCondition(broadcasterId);
    const result = await createSubscription(
      appAccessToken,
      callbackUrl,
      sub.type,
      sub.version,
      condition
    );

    if (result.id) {
      created.push(sub.type);
      await serviceClient.from("twitch_event_subscriptions").insert({
        user_id: userId,
        subscription_id: result.id,
        subscription_type: sub.type,
        status: "enabled",
      });
    } else {
      failed.push(sub.type);
      failures.push({
        type: sub.type,
        message: result.error ?? "unknown error",
      });
    }
  }

  return jsonResponse({
    ok: failed.length === 0,
    created,
    failed,
    failures,
    callbackUrl,
  });
});
