/**
 * Speech marks → a highlight model anchored on character offsets. Copied whole
 * from Readback, evidence and all; `toCodeUnits` is the one addition.
 *
 * Measured against the live API 2026-09-04 (simba-3.2 / harper_32), and the
 * whole reader rests on what that probe found:
 *
 *  - Every mark carries `start` and `end`, character offsets into the exact
 *    `input` string that was sent, and `input.slice(start, end) === value`
 *    held for every mark in every case tried.
 *  - Marks do NOT correspond one-to-one with whitespace tokens. The API
 *    merges ("Dr. Smith" and "item #3" each came back as ONE mark) and
 *    splits ('"this' came back as '"' then 'this').
 *  - Marks can DROP text entirely: in `(a Thursday)` the "(" and "Thursday"
 *    got no mark at all, an 8-character hole in an otherwise covered string.
 *  - The top-level "sentence" node is not a sentence. A three-sentence
 *    paragraph came back as a single sentence chunk holding every word.
 *
 * So: never index marks by token position, never trust the sentence layer.
 * Offsets are the anchor, and `fillGaps` closes the holes so the highlight
 * can never land on nothing while audio is playing.
 */

export interface Mark {
  /** Character offset into the rendered text, inclusive. */
  start: number;
  /** Character offset into the rendered text, exclusive. */
  end: number;
  startMs: number;
  endMs: number;
}

/** Flatten the chunk tree to word marks, in reading order. */
export function flattenMarks(raw: unknown): Mark[] {
  const out: Mark[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const chunk = node as {
      type?: string;
      start?: number;
      end?: number;
      start_time?: number;
      end_time?: number;
      chunks?: unknown;
    };
    if (
      chunk.type === "word" &&
      typeof chunk.start === "number" &&
      typeof chunk.end === "number" &&
      typeof chunk.start_time === "number" &&
      typeof chunk.end_time === "number"
    ) {
      out.push({
        start: chunk.start,
        end: chunk.end,
        startMs: chunk.start_time,
        endMs: chunk.end_time,
      });
    }
    if (chunk.chunks) visit(chunk.chunks);
  };
  visit(raw);
  out.sort((a, b) => a.start - b.start || a.startMs - b.startMs);
  return out;
}

/**
 * Mark offsets as JavaScript counts them.
 *
 * The API counts offsets in Unicode code points; a JavaScript string and the
 * editor count UTF-16 code units. The two agree until the first character
 * outside the Basic Multilingual Plane, which is one code point and two
 * units. Measured 2026-10-01 (simba-3.2 / harper_32): accents, curly quotes
 * and CJK sliced correctly, and every mark after a single "😀" sliced one
 * character early ("with" came back as " wit"), with
 * `billable_characters_count` equal to the code point count.
 */
export function toCodeUnits(marks: readonly Mark[], text: string): Mark[] {
  if (!/[\uD800-\uDBFF]/.test(text)) return [...marks];
  const unitAt: number[] = [];
  let unit = 0;
  for (const character of text) {
    unitAt.push(unit);
    unit += character.length;
  }
  return marks.map((m) => ({ ...m, start: unitAt[m.start] ?? unit, end: unitAt[m.end] ?? unit }));
}

/**
 * Close holes in offset coverage so every character the reader shows belongs
 * to some mark.
 *
 * A gap that is pure whitespace is left alone: skipping a space is invisible.
 * A gap holding real text is absorbed FORWARD, into the mark that follows it,
 * and the direction matters. A dropped word is still spoken, and the audio for
 * it lands inside the next mark's time window, not the previous one's. In the
 * live "(a Thursday)" case the mark for ")" held 682ms, far too long for a
 * bracket and about right for "Thursday)". Absorbing backward would extend the
 * "a" mark's offsets while leaving its 171ms window untouched, so at the moment
 * "Thursday" is spoken the playhead would still land on ")" and highlight one
 * character. Absorbing forward puts the words and the time in the same mark.
 *
 * The first mark is pulled back to 0 and the last pushed out to the end of the
 * text, covering a dropped word at either edge.
 */
export function fillGaps(marks: readonly Mark[], text: string): Mark[] {
  if (marks.length === 0) return [];
  const out = marks.map((m) => ({ ...m }));
  const first = out[0]!;
  if (first.start > 0 && text.slice(0, first.start).trim() !== "") first.start = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i]!;
    const next = out[i + 1]!;
    if (cur.end < next.start && text.slice(cur.end, next.start).trim() !== "") {
      next.start = cur.end;
    }
    // Times must not overlap or the playhead search picks the wrong mark.
    if (cur.endMs > next.startMs) cur.endMs = next.startMs;
  }
  const last = out[out.length - 1]!;
  if (last.end < text.length && text.slice(last.end).trim() !== "") last.end = text.length;
  return out;
}

/** The mark playing at `ms`, or null before the first / after the last. */
export function markAtTime(marks: readonly Mark[], ms: number): Mark | null {
  if (marks.length === 0) return null;
  let lo = 0;
  let hi = marks.length - 1;
  let found: Mark | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = marks[mid]!;
    if (ms < m.startMs) {
      hi = mid - 1;
    } else {
      found = m;
      lo = mid + 1;
    }
  }
  if (found && ms >= found.endMs && found === marks[marks.length - 1]) return null;
  return found;
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Sentence boundaries as character ranges over `text`.
 *
 * Written here rather than taken from the API because the API's sentence
 * layer returned the whole paragraph as one sentence (see the note above).
 * A boundary is terminal punctuation followed by whitespace and something
 * that starts a new sentence; common abbreviations are held back so
 * "Dr. Smith" and "e.g. this" stay whole.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "eg", "ie",
  "no", "fig", "al", "inc", "ltd", "co", "approx", "dept", "est", "min", "max",
]);

export function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    // Absorb runs of terminal punctuation and any closing quote or bracket.
    let j = i;
    while (j + 1 < text.length && ".!?".includes(text[j + 1]!)) j++;
    while (j + 1 < text.length && "\"')]}”’".includes(text[j + 1]!)) j++;
    const after = text.slice(j + 1);
    // A boundary needs whitespace (or the end of the text) after it.
    if (after !== "" && !/^\s/.test(after)) { i = j; continue; }
    if (ch === ".") {
      const before = text.slice(start, i);
      const word = /([A-Za-z.]+)$/.exec(before)?.[1] ?? "";
      const bare = word.replace(/\./g, "").toLowerCase();
      // "Dr." / "e.g." — not a boundary. A single letter is an initial.
      if (ABBREVIATIONS.has(bare) || bare.length === 1) { i = j; continue; }
      // A decimal point inside a number: "6.9x"
      if (/\d$/.test(before) && /^\s*$/.test(after) === false && /^\d/.test(after.trimStart())) {
        i = j;
        continue;
      }
    }
    const end = j + 1;
    if (text.slice(start, end).trim() !== "") ranges.push({ start, end });
    start = end;
    i = j;
  }
  if (text.slice(start).trim() !== "") ranges.push({ start, end: text.length });
  return ranges;
}

export interface TimedRange extends Range {
  startMs: number;
  endMs: number;
}

/**
 * Give each sentence the time span of the marks that fall inside it, so the
 * player can highlight a sentence and step back and forward by one.
 * A sentence with no marks of its own borrows the previous sentence's end,
 * which keeps the sequence monotonic and non-empty.
 */
export function timeSentences(text: string, marks: readonly Mark[]): TimedRange[] {
  const sentences = sentenceRanges(text);
  const out: TimedRange[] = [];
  let cursor = 0;
  for (const s of sentences) {
    const inside = marks.filter((m) => m.start < s.end && m.end > s.start);
    const startMs = inside.length ? Math.min(...inside.map((m) => m.startMs)) : cursor;
    const endMs = inside.length ? Math.max(...inside.map((m) => m.endMs)) : cursor;
    const range: TimedRange = { ...s, startMs: Math.max(startMs, cursor), endMs: Math.max(endMs, cursor) };
    cursor = range.endMs;
    out.push(range);
  }
  return out;
}
