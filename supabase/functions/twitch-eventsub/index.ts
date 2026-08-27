import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  applyAlertTemplate,
  type TwitchAlertType,
} from "../_shared/twitchAlerts.ts";

const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
const TWITCH_EVENTSUB_SECRET = Deno.env.get("TWITCH_EVENTSUB_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const EVENT_TYPE_TO_ALERT: Record<string, TwitchAlertType | undefined> = {
  "channel.follow": "follow",
  "channel.subscribe": "subscribe",
  "channel.subscription.gift": "gift_sub",
  "channel.raid": "raid",
  "channel.cheer": "cheer",
};

async function verifySignature(
  messageId: string,
  timestamp: string,
  body: string,
  signature: string
): Promise<boolean> {
  if (!TWITCH_EVENTSUB_SECRET) return false;

  const message = messageId + timestamp + body;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TWITCH_EVENTSUB_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return expected === signature;
}

function tierLabel(tier: string | undefined): string {
  if (tier === "3000") return "Tier 3";
  if (tier === "2000") return "Tier 2";
  if (tier === "1000") return "Tier 1";
  return tier ?? "1";
}

function buildTemplateVars(
  alertType: TwitchAlertType,
  event: Record<string, unknown>
): Record<string, string> {
  switch (alertType) {
    case "follow":
      return { user: String(event.user_name ?? "Someone") };
    case "subscribe":
      return {
        user: String(event.user_name ?? "Someone"),
        tier: tierLabel(event.tier as string | undefined),
        message: String(event.message ?? "").trim(),
      };
    case "gift_sub":
      return {
        user: String(event.user_name ?? "Someone"),
        total: String(event.total ?? "1"),
        tier: tierLabel(event.tier as string | undefined),
      };
    case "raid":
      return {
        user: String(event.from_broadcaster_user_name ?? "Someone"),
        viewers: String(event.viewers ?? "0"),
      };
    case "cheer":
      return {
        user: String(event.user_name ?? "Someone"),
        bits: String(event.bits ?? "0"),
        message: String(event.message ?? "").trim(),
      };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const messageType = req.headers.get("Twitch-Eventsub-Message-Type") ?? "";
  const messageId = req.headers.get("Twitch-Eventsub-Message-Id") ?? "";
  const timestamp = req.headers.get("Twitch-Eventsub-Message-Timestamp") ?? "";
  const signature = req.headers.get("Twitch-Eventsub-Message-Signature") ?? "";

  if (!messageId || !timestamp || !signature) {
    return new Response("Missing EventSub headers", { status: 400 });
  }

  const valid = await verifySignature(messageId, timestamp, body, signature);
  if (!valid) {
    return new Response("Invalid signature", { status: 403 });
  }

  if (messageType === "webhook_callback_verification") {
    const payload = JSON.parse(body);
    return new Response(payload.challenge, { status: 200 });
  }

  if (messageType === "revocation") {
    return new Response("ok", { status: 200 });
  }

  if (messageType !== "notification") {
    return new Response("ok", { status: 200 });
  }

  const payload = JSON.parse(body);
  const subscriptionType = payload.subscription?.type as string | undefined;
  const event = payload.event as Record<string, unknown> | undefined;

  if (!subscriptionType || !event) {
    return new Response("ok", { status: 200 });
  }

  if (subscriptionType === "channel.subscribe" && event.is_gift) {
    return new Response("ok", { status: 200 });
  }

  const alertType = EVENT_TYPE_TO_ALERT[subscriptionType];
  if (!alertType) {
    return new Response("ok", { status: 200 });
  }

  let broadcasterId = "";
  if (subscriptionType === "channel.raid") {
    broadcasterId = String(event.to_broadcaster_user_id ?? "");
  } else {
    broadcasterId = String(event.broadcaster_user_id ?? "");
  }

  if (!broadcasterId) {
    return new Response("ok", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: tokenRow, error: tokenError } = await supabase
    .from("twitch_tokens")
    .select("user_id")
    .eq("broadcaster_id", broadcasterId)
    .maybeSingle();

  if (tokenError || !tokenRow?.user_id) {
    console.error("No twitch_tokens for broadcaster", broadcasterId, tokenError);
    return new Response("ok", { status: 200 });
  }

  const userId = tokenRow.user_id as string;

  const { data: settings, error: settingsError } = await supabase
    .from("ticker_alert_settings")
    .select("enabled, template, sound_url, duration_ms")
    .eq("user_id", userId)
    .eq("alert_type", alertType)
    .maybeSingle();

  if (settingsError || !settings || !settings.enabled) {
    return new Response("ok", { status: 200 });
  }

  const vars = buildTemplateVars(alertType, event);
  const displayText = applyAlertTemplate(settings.template as string, vars);

  const { error: insertError } = await supabase.from("ticker_alert_events").insert({
    user_id: userId,
    alert_type: alertType,
    display_text: displayText,
    sound_url: settings.sound_url,
    duration_ms: settings.duration_ms,
  });

  if (insertError) {
    console.error("Failed to insert alert event:", insertError.message);
    return new Response("insert failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
