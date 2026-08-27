export const TWITCH_ALERT_TYPES = [
  "follow",
  "subscribe",
  "gift_sub",
  "raid",
  "cheer",
] as const;

export type TwitchAlertType = (typeof TWITCH_ALERT_TYPES)[number];

export const DEFAULT_ALERT_DURATION_MS = 5000;

export const DEFAULT_ALERT_TEMPLATES: Record<TwitchAlertType, string> = {
  follow: "**{user}** just followed!",
  subscribe: "**{user}** subscribed!",
  gift_sub: "**{user}** gifted {total} subs!",
  raid: "**{user}** raided with {viewers} viewers!",
  cheer: "**{user}** cheered {bits} bits!",
};

export function defaultAlertSoundUrl(alertType: TwitchAlertType): string {
  return `/sounds/${alertType}.mp3`;
}

export function formatAlertLabel(alertType: TwitchAlertType): string {
  switch (alertType) {
    case "follow":
      return "Follow";
    case "subscribe":
      return "Subscribe";
    case "gift_sub":
      return "Gift sub";
    case "raid":
      return "Raid";
    case "cheer":
      return "Cheer";
  }
}

export interface TickerAlertSettingsRow {
  user_id: string;
  alert_type: TwitchAlertType;
  enabled: boolean;
  template: string;
  sound_url: string;
  duration_ms: number;
}

export interface TickerAlertEventRow {
  id: string;
  user_id: string;
  alert_type: TwitchAlertType;
  display_text: string;
  sound_url: string;
  duration_ms: number;
  created_at: string;
}

export function applyAlertTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}
