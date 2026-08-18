export interface TickerItem {
  id: string;
  text: string;
  sort_order: number;
  active: boolean;
  hold_seconds?: number;
  created_at: string;
  updated_at: string;
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

export type TickerItemInsert = Pick<TickerItem, "text" | "sort_order" | "active" | "hold_seconds">;
export type TickerItemUpdate = Partial<TickerItemInsert>;

export type HighlightTag = "accent" | "bold" | "italic";

export interface ParsedSegment {
  type: "text" | "highlight";
  content: string;
  tag?: HighlightTag;
}
