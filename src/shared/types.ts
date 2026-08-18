export interface TickerItem {
  id: string;
  text: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type TickerItemInsert = Pick<TickerItem, "text" | "sort_order" | "active">;
export type TickerItemUpdate = Partial<TickerItemInsert>;

export type HighlightTag = "accent" | "bold";

export interface ParsedSegment {
  type: "text" | "highlight";
  content: string;
  tag?: HighlightTag;
}
