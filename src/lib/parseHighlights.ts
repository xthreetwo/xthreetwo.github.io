import type { HighlightTag, ParsedSegment } from "../shared/types";

const VALID_TAGS = new Set<HighlightTag>(["accent", "bold"]);
const TAG_PATTERN = /\{(\/?)(accent|bold)\}/g;

export function parseHighlights(input: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  const tagStack: HighlightTag[] = [];

  for (const match of input.matchAll(TAG_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const isClosing = match[1] === "/";
    const tag = match[2] as HighlightTag;

    if (!VALID_TAGS.has(tag)) {
      continue;
    }

    if (matchIndex > lastIndex) {
      const text = input.slice(lastIndex, matchIndex);
      if (text) {
        segments.push(createSegment(text, tagStack));
      }
    }

    if (isClosing) {
      const openIndex = tagStack.lastIndexOf(tag);
      if (openIndex !== -1) {
        tagStack.splice(openIndex);
      }
    } else {
      tagStack.push(tag);
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < input.length) {
    const text = input.slice(lastIndex);
    if (text) {
      segments.push(createSegment(text, tagStack));
    }
  }

  return segments;
}

function createSegment(content: string, tagStack: HighlightTag[]): ParsedSegment {
  const activeTag = tagStack[tagStack.length - 1];
  if (activeTag) {
    return { type: "highlight", content, tag: activeTag };
  }
  return { type: "text", content };
}

export function renderHighlights(input: string): string {
  return parseHighlights(input)
    .map((segment) => {
      if (segment.type === "highlight" && segment.tag) {
        return `<span class="hl hl--${segment.tag}">${escapeHtml(segment.content)}</span>`;
      }
      return escapeHtml(segment.content);
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
