import "./overlay.css";
import { supabase } from "../lib/supabase";
import { renderHighlights } from "../lib/parseHighlights";
import { getItemHoldMs, type TickerItem } from "../shared/types";

const stageEl = document.getElementById("ticker-stage");

if (!stageEl) {
  throw new Error("Ticker stage element not found");
}

const ENTER_MS = 1000;
const EXIT_MS = 1000;

let items: TickerItem[] = [];
let cycleId = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function showEmptyState(): void {
  stageEl!.innerHTML =
    '<span class="ticker__empty">No ticker items — add some in the admin panel</span>';
}

async function playItem(item: TickerItem, runId: number): Promise<void> {
  if (runId !== cycleId) return;

  stageEl!.innerHTML = `
    <div class="ticker__item">
      <div class="ticker__item-track">
        <div class="ticker__item-content">${renderHighlights(item.text)}</div>
      </div>
    </div>
  `;
  const itemEl = stageEl!.querySelector(".ticker__item");
  if (!itemEl) return;

  await sleep(50);
  if (runId !== cycleId) return;

  itemEl.classList.add("ticker__item--visible");
  setupHorizontalScroll(itemEl as HTMLElement, item);

  await sleep(ENTER_MS + getItemHoldMs(item));
  if (runId !== cycleId) return;

  itemEl.classList.remove("ticker__item--visible");
  itemEl.classList.add("ticker__item--exit");
  await sleep(EXIT_MS);
}

function setupHorizontalScroll(itemEl: HTMLElement, item: TickerItem): void {
  const track = itemEl.querySelector(".ticker__item-track") as HTMLElement | null;
  const content = itemEl.querySelector(".ticker__item-content") as HTMLElement | null;
  if (!track || !content) return;

  const overflow = content.scrollWidth - track.clientWidth;
  if (overflow <= 8) return;

  const holdMs = getItemHoldMs(item);
  const pixelsPerSecond = 70;
  const scrollDurationMs = Math.min(
    holdMs - 800,
    Math.max(3000, (overflow / pixelsPerSecond) * 1000)
  );

  if (scrollDurationMs < 1500) return;

  content.classList.add("ticker__item-content--scroll");
  content.style.setProperty("--scroll-distance", `-${overflow}px`);
  content.style.setProperty("--scroll-duration", `${scrollDurationMs}ms`);
}

async function runCycle(runId: number): Promise<void> {
  if (items.length === 0) {
    showEmptyState();
    return;
  }

  while (runId === cycleId) {
    for (const item of items) {
      if (runId !== cycleId) return;
      await playItem(item, runId);
    }
  }
}

function startCycle(): void {
  cycleId += 1;
  const runId = cycleId;
  runCycle(runId);
}

async function refreshItems(): Promise<void> {
  items = await fetchItems();
  startCycle();
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
