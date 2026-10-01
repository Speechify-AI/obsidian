/** Splitting text that is too long for one synthesis call. Copied from Readback. */

/** One synthesis call takes at most 2,000 characters on /v1/audio/speech. */
export const SPEECH_LIMIT = 2000;

export interface Range {
  start: number;
  end: number;
}

/**
 * Split text too long for `limit` into character ranges that are not,
 * preferring sentence boundaries, then words, then a hard cut for a single
 * token longer than the limit.
 *
 * Ranges rather than strings, because the speech marks that come back carry
 * offsets into the exact string sent. Sending `text.slice(start, end)` means
 * a mark's offset plus `start` is its offset in the whole text. The ranges
 * tile the text end to end and never overlap.
 */
export function chunkRanges(text: string, limit = SPEECH_LIMIT): Range[] {
  if (text.length <= limit) return text === "" ? [] : [{ start: 0, end: text.length }];
  const ranges: Range[] = [];
  let start = 0;
  while (text.length - start > limit) {
    const window = text.slice(start, start + limit + 1);
    let cut = lastBoundary(window, /[.!?]["')\]]?\s/g);
    if (cut <= 0) cut = lastBoundary(window, /\s/g);
    if (cut <= 0) cut = limit;
    ranges.push({ start, end: start + cut });
    start += cut;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges;
}

/** Index just past the last match of `pattern` in `window`, or -1. */
function lastBoundary(window: string, pattern: RegExp): number {
  let cut = -1;
  for (const match of window.matchAll(pattern)) cut = match.index + match[0].length;
  return cut;
}
