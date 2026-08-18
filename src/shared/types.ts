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

export function getItemHoldMs(item: TickerItem): number {
  const seconds =
    item.hold_seconds != null && item.hold_seconds > 0
      ? item.hold_seconds
      : DEFAULT_HOLD_SECONDS;
  return seconds * 1000;
}

export type TickerItemInsert = Pick<TickerItem, "text" | "sort_order" | "active" | "hold_seconds">;
export type TickerItemUpdate = Partial<TickerItemInsert>;

export type HighlightTag = "accent" | "bold";

export interface ParsedSegment {
  type: "text" | "highlight";
  content: string;
  tag?: HighlightTag;
}
