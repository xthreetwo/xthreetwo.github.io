import { renderHighlights } from "./parseHighlights";
import { formatMusicTitle, type TickerItem } from "../shared/types";

export function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Overlay + admin preview: Now Playing: [art] song - artist */
export function renderMusicDisplayHtml(
  item: TickerItem,
  albumArtClass: string
): string {
  const title = formatMusicTitle(item.music_track ?? "", item.music_artist ?? "");
  const albumArtUrl = (item.music_album_art_url ?? "").trim();
  const labelHtml = renderHighlights("*Now Playing:*");
  const artHtml = albumArtUrl
    ? `<img class="${albumArtClass}" src="${escapeHtmlAttr(albumArtUrl)}" alt="" />`
    : "";
  const titleHtml = escapeHtmlText(title);

  return `${labelHtml} ${artHtml} ${titleHtml}`;
}
