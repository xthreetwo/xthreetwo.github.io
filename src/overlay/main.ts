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

  stageEl!.innerHTML = `<div class="ticker__item">${renderHighlights(item.text)}</div>`;
  const itemEl = stageEl!.querySelector(".ticker__item");
  if (!itemEl) return;

  // Start above the bar, then ease into view
  await sleep(50);
  if (runId !== cycleId) return;

  itemEl.classList.add("ticker__item--visible");
  await sleep(ENTER_MS + getItemHoldMs(item));
  if (runId !== cycleId) return;

  itemEl.classList.remove("ticker__item--visible");
  itemEl.classList.add("ticker__item--exit");
  await sleep(EXIT_MS);
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
