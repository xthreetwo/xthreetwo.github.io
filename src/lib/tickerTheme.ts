import { supabase } from "./supabase";

export const DEFAULT_TICKER_ACCENT = "#ff5b20";

export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const shortMatch = trimmed.match(/^#?([0-9a-fA-F]{3})$/);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;

  return `#${match[1].toLowerCase()}`;
}

export function darkenHex(hex: string, factor = 0.12): string {
  const normalized = normalizeHexColor(hex) ?? hex;
  const value = parseInt(normalized.slice(1), 16);
  const r = Math.max(0, Math.round(((value >> 16) & 0xff) * (1 - factor)));
  const g = Math.max(0, Math.round(((value >> 8) & 0xff) * (1 - factor)));
  const b = Math.max(0, Math.round((value & 0xff) * (1 - factor)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function applyTickerAccent(hex: string): void {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return;

  const root = document.documentElement;
  root.style.setProperty("--ticker-accent", normalized);
  root.style.setProperty("--admin-accent-hover", darkenHex(normalized));
}

export async function fetchTickerAccent(): Promise<string> {
  const { data, error } = await supabase
    .from("ticker_settings")
    .select("accent_color")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("Failed to load ticker settings:", error.message);
    return DEFAULT_TICKER_ACCENT;
  }

  const accent = normalizeHexColor(data?.accent_color ?? "") ?? DEFAULT_TICKER_ACCENT;
  applyTickerAccent(accent);
  return accent;
}

export async function saveTickerAccent(hex: string): Promise<string | null> {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;

  const { error } = await supabase.from("ticker_settings").upsert({
    id: 1,
    accent_color: normalized,
  });

  if (error) {
    console.error("Failed to save ticker accent:", error.message);
    return null;
  }

  applyTickerAccent(normalized);
  return normalized;
}
