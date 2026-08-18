import type { HighlightTag, ParsedSegment } from "../shared/types";

/**
 * Markdown-style highlights (preferred):
 *   **text**  → orange accent (e.g. **!livery**)
 *   *text*    → bold
 *   'text'    → italic
 *
 * Legacy tags still supported for older items:
 *   {accent}text{/accent}  {bold}text{/bold}  {italic}text{/italic}
 */
const HIGHLIGHT_PATTERN =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|'([^']+)'|\{accent\}([\s\S]*?)\{\/accent\}|\{bold\}([\s\S]*?)\{\/bold\}|\{italic\}([\s\S]*?)\{\/italic\}/g;

export function parseHighlights(input: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(HIGHLIGHT_PATTERN)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", content: input.slice(lastIndex, matchIndex) });
    }

    const highlight = matchToHighlight(match);
    if (highlight) {
      segments.push({
        type: "highlight",
        content: highlight.content,
        tag: highlight.tag,
      });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", content: input.slice(lastIndex) });
  }

  return segments;
}

function matchToHighlight(match: RegExpMatchArray): { tag: HighlightTag; content: string } | null {
  if (match[1] !== undefined) {
    return { tag: "accent", content: match[1] };
  }
  if (match[2] !== undefined) {
    return { tag: "bold", content: match[2] };
  }
  if (match[3] !== undefined) {
    return { tag: "italic", content: match[3] };
  }
  if (match[4] !== undefined) {
    return { tag: "accent", content: match[4] };
  }
  if (match[5] !== undefined) {
    return { tag: "bold", content: match[5] };
  }
  if (match[6] !== undefined) {
    return { tag: "italic", content: match[6] };
  }
  return null;
}

export function renderHighlights(input: string): string {
  return parseHighlights(input)
    .map((segment, index, segments) => {
      const content = escapeHtml(segment.content);

      if (segment.type === "highlight" && segment.tag) {
        return `<span class="hl hl--${segment.tag}">${content}</span>`;
      }

      const prev = segments[index - 1];
      if (prev?.type === "highlight" && segment.content.startsWith(" ")) {
        return "&nbsp;" + escapeHtml(segment.content.slice(1));
      }

      return content;
    })
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
