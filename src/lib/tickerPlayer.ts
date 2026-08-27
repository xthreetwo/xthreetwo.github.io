import { renderHighlights } from "./parseHighlights";
import {
  formatMusicLabel,
  formatMusicTitle,
  formatStreamTitleValue,
  getItemDisplayText,
  getItemHoldMs,
  isMusicItem,
  isStreamTitleItem,
  type TickerItem,
} from "../shared/types";
import { renderTwitchIconMarkup } from "../shared/twitchIcon";

export const TICKER_ENTER_MS = 1000;
export const TICKER_EXIT_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhilePaused(
  isCycleActive: (id: number) => boolean,
  cycleRunId: number,
  isPaused: () => boolean
): Promise<boolean> {
  while (isPaused()) {
    if (!isCycleActive(cycleRunId)) return false;
    await sleep(50);
  }
  return isCycleActive(cycleRunId);
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

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function playItem(
  stageEl: HTMLElement,
  item: TickerItem,
  itemRunId: number,
  isItemActive: (id: number) => boolean,
  getActiveItems: () => TickerItem[]
): Promise<void> {
  if (!isItemActive(itemRunId)) return;

  const freshItem = getActiveItems().find((i) => i.id === item.id);
  if (!freshItem) return;

  item = freshItem;

  const albumArtUrl = (item.music_album_art_url ?? "").trim();
  let contentHtml: string;
  let contentClass = "ticker__item-content";

  if (isMusicItem(item)) {
    const labelHtml = renderHighlights(formatMusicLabel());
    const titleHtml = renderHighlights(
      formatMusicTitle(item.music_track ?? "", item.music_artist ?? "")
    );
    const albumArtHtml = albumArtUrl
      ? `<img class="ticker__album-art" src="${escapeAttr(albumArtUrl)}" alt="" />`
      : "";

    contentClass = "ticker__item-content ticker__item-content--music";
    contentHtml = `
      <span class="ticker__item-text">${labelHtml}</span>
      ${albumArtHtml}
      <span class="ticker__item-text">${titleHtml}</span>
    `;
  } else if (isStreamTitleItem(item)) {
    const titleHtml = renderHighlights(formatStreamTitleValue(item.twitch_stream_title ?? ""));

    contentClass = "ticker__item-content ticker__item-content--stream-title";
    contentHtml = `
      ${renderTwitchIconMarkup("ticker__twitch-icon")}
      <span class="ticker__item-text">${titleHtml}</span>
    `;
  } else {
    contentHtml = `<span class="ticker__item-text">${renderHighlights(getItemDisplayText(item))}</span>`;
  }

  stageEl.innerHTML = `
    <div class="ticker__item">
      <div class="ticker__item-track">
        <div class="${contentClass}">
          ${contentHtml}
        </div>
      </div>
    </div>
  `;
  const itemEl = stageEl.querySelector(".ticker__item");
  if (!itemEl) return;

  await sleep(50);
  if (!isItemActive(itemRunId)) return;

  itemEl.classList.add("ticker__item--visible");
  setupHorizontalScroll(itemEl as HTMLElement, item);

  await sleep(TICKER_ENTER_MS + getItemHoldMs(item));
  if (!isItemActive(itemRunId)) return;

  itemEl.classList.remove("ticker__item--visible");
  itemEl.classList.add("ticker__item--exit");
  await sleep(TICKER_EXIT_MS);
}

export function showTickerEmpty(stageEl: HTMLElement, message: string): void {
  stageEl.innerHTML = `<span class="ticker__empty">${message}</span>`;
}

export async function runTickerCycle(
  stageEl: HTMLElement,
  getActiveItems: () => TickerItem[],
  cycleRunId: number,
  isCycleActive: (id: number) => boolean,
  isPaused: () => boolean,
  getItemInterruptId: () => number,
  emptyMessage: string
): Promise<void> {
  const items = getActiveItems();
  if (items.length === 0) {
    showTickerEmpty(stageEl, emptyMessage);
    return;
  }

  while (isCycleActive(cycleRunId)) {
    if (!(await waitWhilePaused(isCycleActive, cycleRunId, isPaused))) return;

    const cycleItems = getActiveItems();
    if (cycleItems.length === 0) {
      showTickerEmpty(stageEl, emptyMessage);
      return;
    }

    for (const item of cycleItems) {
      if (!(await waitWhilePaused(isCycleActive, cycleRunId, isPaused))) return;

      const itemRunId = getItemInterruptId();
      await playItem(
        stageEl,
        item,
        itemRunId,
        (id) => id === getItemInterruptId() && isCycleActive(cycleRunId),
        getActiveItems
      );
    }
  }
}

export interface TickerPlayerControls {
  refresh: () => void;
  stop: () => void;
  interruptAndPause: () => void;
  resume: () => void;
}

export function createTickerPlayer(
  stageEl: HTMLElement,
  getActiveItems: () => TickerItem[],
  emptyMessage: string
): TickerPlayerControls {
  let cycleRunId = 0;
  let itemInterruptId = 0;
  let paused = false;

  const isCycleActive = (id: number) => id === cycleRunId;
  const isPaused = () => paused;
  const getItemInterruptId = () => itemInterruptId;

  function start(): void {
    cycleRunId += 1;
    itemInterruptId += 1;
    paused = false;
    runTickerCycle(
      stageEl,
      getActiveItems,
      cycleRunId,
      isCycleActive,
      isPaused,
      getItemInterruptId,
      emptyMessage
    );
  }

  return {
    refresh: start,
    stop: () => {
      cycleRunId += 1;
      itemInterruptId += 1;
      paused = false;
    },
    interruptAndPause: () => {
      itemInterruptId += 1;
      paused = true;
    },
    resume: () => {
      paused = false;
    },
  };
}
