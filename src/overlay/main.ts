import "./overlay.css";
import { supabase } from "../lib/supabase";
import { renderHighlights } from "../lib/parseHighlights";
import type { TickerItem } from "../shared/types";

const contentEl = document.getElementById("ticker-content");
const trackEl = document.getElementById("ticker-track");

if (!contentEl || !trackEl) {
  throw new Error("Ticker DOM elements not found");
}

let items: TickerItem[] = [];

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

function buildItemHtml(item: TickerItem): string {
  return `<span class="ticker__item">${renderHighlights(item.text)}</span>`;
}

function renderTicker(): void {
  if (items.length === 0) {
    contentEl!.innerHTML = '<span class="ticker__empty">No ticker items — add some in the admin panel</span>';
    trackEl!.style.animation = "none";
    return;
  }

  const html = items.map(buildItemHtml).join("");
  // Duplicate content for seamless loop
  contentEl!.innerHTML = html + html;

  // Reset animation to recalculate duration based on content width
  trackEl!.style.animation = "none";
  void trackEl!.offsetWidth;
  trackEl!.style.animation = "";
}

async function init(): Promise<void> {
  items = await fetchItems();
  renderTicker();

  supabase
    .channel("ticker_items_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ticker_items" },
      async () => {
        items = await fetchItems();
        renderTicker();
      }
    )
    .subscribe();
}

init();
