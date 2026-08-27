import "./overlay.css";
import { supabase } from "../lib/supabase";
import { createAlertPlayer, subscribeToAlertEvents } from "../lib/alertPlayer";
import { createTickerPlayer } from "../lib/tickerPlayer";
import { applyTickerAccent, fetchTickerAccent } from "../lib/tickerTheme";
import type { TickerItem } from "../shared/types";

const stageEl = document.getElementById("ticker-stage");
const alertLayerEl = document.getElementById("ticker-alert-layer");
const tickerEl = document.querySelector(".ticker");

if (!stageEl || !alertLayerEl || !tickerEl) {
  throw new Error("Ticker overlay elements not found");
}

let items: TickerItem[] = [];

const player = createTickerPlayer(
  stageEl,
  () => items,
  "No ticker items — add some in the admin panel"
);

const alertPlayer = createAlertPlayer(tickerEl as HTMLElement, alertLayerEl, player);

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

async function syncItemsFromDatabase(): Promise<void> {
  const newItems = await fetchItems();
  const hadItems = items.length > 0;
  const hasItems = newItems.length > 0;

  items = newItems;

  if ((!hadItems && hasItems) || (hadItems && !hasItems)) {
    player.refresh();
  }
}

async function init(): Promise<void> {
  await fetchTickerAccent();

  items = await fetchItems();
  player.refresh();

  subscribeToAlertEvents((event) => alertPlayer.enqueue(event));

  supabase
    .channel("ticker_items_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ticker_items" },
      () => syncItemsFromDatabase()
    )
    .subscribe();

  supabase
    .channel("ticker_settings_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ticker_settings" },
      (payload) => {
        const accent = (payload.new as { accent_color?: string } | null)?.accent_color;
        if (accent) applyTickerAccent(accent);
      }
    )
    .subscribe();
}

init();
