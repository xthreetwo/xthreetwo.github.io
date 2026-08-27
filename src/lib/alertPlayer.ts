import { renderHighlights } from "./parseHighlights";
import { supabase } from "./supabase";
import type { TickerAlertEventRow } from "../shared/twitchAlerts";
import type { TickerPlayerControls } from "./tickerPlayer";

const TICKER_ALERT_EXIT_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setAlertVisualActive(tickerEl: HTMLElement, active: boolean): void {
  tickerEl.classList.toggle("ticker--alert-active", active);
}

function clearAlertVisuals(tickerEl: HTMLElement): void {
  setAlertVisualActive(tickerEl, false);
}

async function playAlertSound(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

  try {
    const audio = new Audio(trimmed);
    await audio.play();
  } catch (error) {
    console.warn("Alert sound could not play:", error);
  }
}

async function showAlert(
  tickerEl: HTMLElement,
  alertLayerEl: HTMLElement,
  event: TickerAlertEventRow
): Promise<void> {
  setAlertVisualActive(tickerEl, true);

  alertLayerEl.hidden = false;
  alertLayerEl.innerHTML = `
    <div class="ticker__alert">
      <div class="ticker__alert-track">
        <div class="ticker__alert-content">
          <span class="ticker__item-text">${renderHighlights(event.display_text)}</span>
        </div>
      </div>
    </div>
  `;

  const alertEl = alertLayerEl.querySelector(".ticker__alert");
  if (!alertEl) {
    console.warn("Alert element missing after render");
    return;
  }

  await sleep(30);
  alertEl.classList.add("ticker__alert--visible");

  await playAlertSound(event.sound_url);
  await sleep(event.duration_ms);

  alertEl.classList.remove("ticker__alert--visible");
  alertEl.classList.add("ticker__alert--exit");
  await sleep(TICKER_ALERT_EXIT_MS);

  alertLayerEl.hidden = true;
  alertLayerEl.innerHTML = "";
}

export function createAlertPlayer(
  tickerEl: HTMLElement,
  alertLayerEl: HTMLElement,
  tickerPlayer: TickerPlayerControls
): { enqueue: (event: TickerAlertEventRow) => void } {
  const queue: TickerAlertEventRow[] = [];
  let processing = false;

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;

    try {
      while (queue.length > 0) {
        const event = queue.shift()!;
        tickerPlayer.interruptAndPause();
        try {
          await showAlert(tickerEl, alertLayerEl, event);
        } catch (error) {
          console.error("Alert playback failed:", error);
        } finally {
          clearAlertVisuals(tickerEl);
          alertLayerEl.hidden = true;
          alertLayerEl.innerHTML = "";
          tickerPlayer.resume();
        }
      }
    } finally {
      processing = false;
    }
  }

  function enqueue(event: TickerAlertEventRow): void {
    queue.push(event);
    processQueue();
  }

  return { enqueue };
}

export function subscribeToAlertEvents(
  onAlert: (event: TickerAlertEventRow) => void
): void {
  supabase
    .channel("ticker_alert_events_changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "ticker_alert_events" },
      (payload) => {
        const row = payload.new as TickerAlertEventRow;
        if (row?.id) onAlert(row);
      }
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        console.info("Overlay subscribed to ticker alert events");
      } else if (status === "CHANNEL_ERROR") {
        console.error("Alert realtime channel error:", err?.message ?? status);
      } else if (status === "TIMED_OUT") {
        console.error("Alert realtime subscription timed out");
      }
    });
}
