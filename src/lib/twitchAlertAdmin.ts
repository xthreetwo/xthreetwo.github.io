import { supabase } from "./supabase";
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
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("twitch-eventsub-register");

  if (error) {
    console.error("EventSub register failed:", error.message);
    return { ok: false, error: error.message };
  }

  const body = data as { ok?: boolean; created?: string[]; failed?: string[]; error?: string };
  return {
    ok: Boolean(body?.ok),
    created: body?.created,
    failed: body?.failed,
    error: body?.error,
  };
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
