import { formatAcrallyRankLabel, formatAcrallyStageLabel } from "./acrallyStages";

export type TickerItemType = "standard" | "acrally";

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
  created_at: string;
  updated_at: string;
}

export function isAcrallyItem(item: TickerItem): boolean {
  return item.item_type === "acrally";
}

export function formatAcrallyText(stage: string, rank: string): string {
  const stageLabel = formatAcrallyStageLabel(stage);
  const rankLabel = formatAcrallyRankLabel(rank);
  const rankDisplay = rankLabel === "—" ? "—" : `{{${rankLabel}}}`;
  return `*Current Stage:* ${stageLabel} **Current Rank:** ${rankDisplay}`;
}

export function getItemDisplayText(item: TickerItem): string {
  if (isAcrallyItem(item)) {
    const stage = item.acrally_stage?.trim() || "";
    const rank = item.acrally_rank?.trim() || "";
    return formatAcrallyText(stage, rank);
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
>;
export type TickerItemUpdate = Partial<TickerItemInsert>;

export type HighlightTag = "accent" | "accentPlain" | "bold" | "italic";

export interface ParsedSegment {
  type: "text" | "highlight";
  content: string;
  tag?: HighlightTag;
}
