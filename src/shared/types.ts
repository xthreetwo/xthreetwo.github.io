import { formatAcrallyRankLabel, formatAcrallyStageLabel } from "./acrallyStages";

export type TickerItemType = "standard" | "acrally" | "music" | "stream_title";

export interface TickerItem {
  id: string;
  text: string;
  sort_order: number;
  active: boolean;
  hold_seconds?: number;
  item_type?: TickerItemType;
  acrally_stage?: string | null;
  acrally_rank?: string | null;
  acrally_stage_ranks?: Record<string, string> | null;
  music_track?: string | null;
  music_artist?: string | null;
  music_album_art_url?: string | null;
  twitch_stream_title?: string | null;
  created_at: string;
  updated_at: string;
}

export function isAcrallyItem(item: TickerItem): boolean {
  return item.item_type === "acrally";
}

export function isMusicItem(item: TickerItem): boolean {
  return item.item_type === "music";
}

export function isStreamTitleItem(item: TickerItem): boolean {
  return item.item_type === "stream_title";
}

export function formatAcrallyText(stage: string, rank: string): string {
  const stageLabel = formatAcrallyStageLabel(stage);
  const rankLabel = formatAcrallyRankLabel(rank);
  const rankDisplay = rankLabel === "—" ? "—" : `{{${rankLabel}}}`;
  return `*Current Stage:* ${stageLabel} **Current Rank:** ${rankDisplay}`;
}

export function formatMusicLabel(): string {
  return "*Now Playing:*";
}

export function formatMusicTitle(track: string, artist: string): string {
  const trimmedTrack = track.trim();
  const trimmedArtist = artist.trim();

  if (!trimmedTrack && !trimmedArtist) {
    return "—";
  }

  const title = trimmedArtist ? `${trimmedTrack} - ${trimmedArtist}` : trimmedTrack;
  return `**${title}**`;
}

export function formatMusicText(track: string, artist: string): string {
  return `${formatMusicLabel()} ${formatMusicTitle(track, artist)}`;
}

export function formatStreamTitleValue(title: string): string {
  const trimmed = title.trim();
  // Single asterisks → bold (not orange accent; ** is accent in highlight syntax).
  return trimmed ? `*${trimmed}*` : "—";
}

export function formatStreamTitleText(title: string): string {
  return formatStreamTitleValue(title);
}

export function getItemDisplayText(item: TickerItem): string {
  if (isAcrallyItem(item)) {
    const stage = item.acrally_stage?.trim() || "";
    const rank = item.acrally_rank?.trim() || "";
    return formatAcrallyText(stage, rank);
  }

  if (isMusicItem(item)) {
    return formatMusicText(item.music_track ?? "", item.music_artist ?? "");
  }

  if (isStreamTitleItem(item)) {
    return formatStreamTitleText(item.twitch_stream_title ?? "");
  }

  return item.text;
}

export type AcrallyStageRanks = Record<string, string>;

export function parseAcrallyStageRanks(raw: unknown): AcrallyStageRanks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const result: AcrallyStageRanks = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export function getAcrallyRankForStage(item: TickerItem, stage: string): string {
  const ranks = parseAcrallyStageRanks(item.acrally_stage_ranks);
  return ranks[stage]?.trim() ?? "";
}

export function withAcrallyRankForStage(
  ranks: AcrallyStageRanks,
  stage: string,
  rank: string
): AcrallyStageRanks {
  return { ...ranks, [stage]: rank };
}

export function formatAcrallyDisplayText(stage: string, rank: string): string {
  return formatAcrallyText(stage, rank);
}

export const DEFAULT_HOLD_SECONDS = 5;

export const HOLD_PRESETS = {
  default: 5,
  extended: 10,
  super: 15,
} as const;

export type HoldPreset = keyof typeof HOLD_PRESETS;

export function presetFromSeconds(seconds?: number): HoldPreset {
  if (seconds === HOLD_PRESETS.extended) return "extended";
  if (seconds === HOLD_PRESETS.super) return "super";
  return "default";
}

export function secondsFromPreset(preset: string): number {
  return HOLD_PRESETS[preset as HoldPreset] ?? DEFAULT_HOLD_SECONDS;
}

export function formatHoldLabel(seconds?: number): string {
  const preset = presetFromSeconds(seconds);
  switch (preset) {
    case "extended":
      return "Extended (10s)";
    case "super":
      return "Super (15s)";
    default:
      return "Default (5s)";
  }
}

export function getItemHoldMs(item: TickerItem): number {
  const seconds =
    item.hold_seconds != null && item.hold_seconds > 0
      ? item.hold_seconds
      : DEFAULT_HOLD_SECONDS;
  return seconds * 1000;
}

export type TickerItemInsert = Pick<
  TickerItem,
  | "text"
  | "sort_order"
  | "active"
  | "hold_seconds"
  | "item_type"
  | "acrally_stage"
  | "acrally_rank"
  | "acrally_stage_ranks"
  | "music_track"
  | "music_artist"
  | "music_album_art_url"
  | "twitch_stream_title"
>;
export type TickerItemUpdate = Partial<TickerItemInsert>;

export type HighlightTag = "accent" | "accentPlain" | "bold" | "italic";

export interface ParsedSegment {
  type: "text" | "highlight";
  content: string;
  tag?: HighlightTag;
}
