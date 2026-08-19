import "./overlay.css";
import { supabase } from "../lib/supabase";
import { createTickerPlayer } from "../lib/tickerPlayer";
import type { TickerItem } from "../shared/types";

const stageEl = document.getElementById("ticker-stage");

if (!stageEl) {
  throw new Error("Ticker stage element not found");
}

let items: TickerItem[] = [];

const player = createTickerPlayer(
  stageEl,
  () => items,
  "No ticker items — add some in the admin panel"
);

async function fetchItems(): Promise<TickerItem[]> {
  const { data, error } = await supabase
    .from("ticker_items")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to fetch ticker items:", error.message);
    return [];
  }

  return data ?? [];
}

async function refreshItems(): Promise<void> {
  items = await fetchItems();
  player.refresh();
}

async function init(): Promise<void> {
  await refreshItems();

  supabase
    .channel("ticker_items_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ticker_items" },
      () => refreshItems()
    )
    .subscribe();
}

init();
