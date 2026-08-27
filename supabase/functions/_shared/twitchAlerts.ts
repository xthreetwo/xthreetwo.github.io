export const TWITCH_ALERT_TYPES = [
  "follow",
  "subscribe",
  "gift_sub",
  "raid",
  "cheer",
] as const;

export type TwitchAlertType = (typeof TWITCH_ALERT_TYPES)[number];

export const DEFAULT_ALERT_DURATION_MS = 7000;

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

export function applyAlertTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

export const EVENTSUB_SUBSCRIPTIONS: Array<{
  type: string;
  version: string;
  buildCondition: (broadcasterId: string) => Record<string, string>;
}> = [
  {
    type: "channel.follow",
    version: "2",
    buildCondition: (broadcasterId) => ({
      broadcaster_user_id: broadcasterId,
      moderator_user_id: broadcasterId,
    }),
  },
  {
    type: "channel.subscribe",
    version: "1",
    buildCondition: (broadcasterId) => ({ broadcaster_user_id: broadcasterId }),
  },
  {
    type: "channel.subscription.gift",
    version: "1",
    buildCondition: (broadcasterId) => ({ broadcaster_user_id: broadcasterId }),
  },
  {
    type: "channel.raid",
    version: "1",
    buildCondition: (broadcasterId) => ({ to_broadcaster_user_id: broadcasterId }),
  },
  {
    type: "channel.cheer",
    version: "1",
    buildCondition: (broadcasterId) => ({ broadcaster_user_id: broadcasterId }),
  },
];
