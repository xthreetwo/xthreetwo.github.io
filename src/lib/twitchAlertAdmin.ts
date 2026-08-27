import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import {
  DEFAULT_ALERT_DURATION_MS,
  DEFAULT_ALERT_TEMPLATES,
  TWITCH_ALERT_TYPES,
  type TickerAlertSettingsRow,
  type TwitchAlertType,
  defaultAlertSoundUrl,
} from "../shared/twitchAlerts";

export async function registerTwitchEventSub(): Promise<{
  ok: boolean;
  created?: string[];
  failed?: string[];
  failures?: Array<{ type: string; message: string }>;
  error?: string;
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    return { ok: false, error: "Not signed in — sign out and sign in again." };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, error: "Supabase URL or API key is not configured in .env" };
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twitch-eventsub-register`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: "{}",
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const message =
        typeof body?.error === "string" ? body.error : `Request failed (HTTP ${res.status})`;
      return {
        ok: false,
        error: message,
        created: body?.created,
        failed: body?.failed,
        failures: body?.failures,
      };
    }

    return {
      ok: Boolean(body?.ok),
      created: body?.created,
      failed: body?.failed,
      failures: body?.failures,
      error: body?.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    console.error("EventSub register failed:", message);
    return {
      ok: false,
      error: `Could not reach Edge Function (${message}). Redeploy twitch-eventsub-register and check CORS.`,
    };
  }
}

export function formatEventSubRegisterError(result: {
  ok: boolean;
  failed?: string[];
  failures?: Array<{ type: string; message: string }>;
  error?: string;
}): string {
  if (result.error) {
    return result.error;
  }

  if (result.failures && result.failures.length > 0) {
    return result.failures.map((f) => `${f.type}: ${f.message}`).join("\n");
  }

  if (result.failed && result.failed.length > 0) {
    return `Failed types: ${result.failed.join(", ")}`;
  }

  return "Unknown error — check Edge Function logs in Supabase Dashboard.";
}

export async function seedAlertSettings(userId: string): Promise<void> {
  const rows = TWITCH_ALERT_TYPES.map((alertType) => ({
    user_id: userId,
    alert_type: alertType,
    enabled: true,
    template: DEFAULT_ALERT_TEMPLATES[alertType],
    sound_url: defaultAlertSoundUrl(alertType),
    duration_ms: DEFAULT_ALERT_DURATION_MS,
  }));

  const { error } = await supabase.from("ticker_alert_settings").upsert(rows, {
    onConflict: "user_id,alert_type",
    ignoreDuplicates: true,
  });

  if (error) {
    console.error("Failed to seed alert settings:", error.message);
  }
}

export async function loadAlertSettings(userId: string): Promise<TickerAlertSettingsRow[]> {
  const { data, error } = await supabase
    .from("ticker_alert_settings")
    .select("*")
    .eq("user_id", userId)
    .order("alert_type");

  if (error) {
    console.error("Failed to load alert settings:", error.message);
    return [];
  }

  return (data ?? []) as TickerAlertSettingsRow[];
}

export async function saveAlertSettings(
  userId: string,
  settings: TickerAlertSettingsRow[]
): Promise<boolean> {
  const rows = settings.map((row) => ({
    user_id: userId,
    alert_type: row.alert_type,
    enabled: row.enabled,
    template: row.template,
    sound_url: row.sound_url,
    duration_ms: row.duration_ms,
  }));

  const { error } = await supabase.from("ticker_alert_settings").upsert(rows, {
    onConflict: "user_id,alert_type",
  });

  if (error) {
    alert(`Failed to save alert settings: ${error.message}`);
    return false;
  }

  return true;
}

export async function insertTestAlert(
  userId: string,
  alertType: TwitchAlertType,
  settings: TickerAlertSettingsRow
): Promise<boolean> {
  const displayText = settings.template
    .replace(/\{user\}/g, "TestUser")
    .replace(/\{tier\}/g, "Tier 1")
    .replace(/\{total\}/g, "5")
    .replace(/\{viewers\}/g, "42")
    .replace(/\{bits\}/g, "100")
    .replace(/\{message\}/g, "test message");

  const { error } = await supabase.from("ticker_alert_events").insert({
    user_id: userId,
    alert_type: alertType,
    display_text: displayText,
    sound_url: settings.sound_url,
    duration_ms: settings.duration_ms,
  });

  if (error) {
    alert(`Failed to send test alert: ${error.message}`);
    return false;
  }

  return true;
}

export async function countEventSubscriptions(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("twitch_event_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    console.error("Failed to count subscriptions:", error.message);
    return 0;
  }

  return count ?? 0;
}
