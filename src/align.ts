/**
 * Where spoken text sits in the text Reading view shows.
 *
 * The editor is painted by note offset. Reading view is rendered HTML with no
 * offsets in it, only the lines each section came from. So inside a section
 * the spoken words are looked up in the words on screen, in order. The two
 * differ in small ways, both ways round: the screen shows a bare URL, the
 * "#" of a tag and "Note > Heading" for a link to a heading, none of which is
 * spoken, and it shows "&" where the note and the speech have "&amp;".
 * A word that cannot be found is left unpainted and the next one carries on.
 */
import type { Passage, SourceRange } from "./speakable.ts";

/** The furthest a word may sit past the last one found. A long bare URL fits; a later repeat of the word does not. */
const MAX_SKIP = 400;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
/** A whole word, or one character of punctuation: "Tides." is looked up as "Tides" and then ".". */
const PIECE = /[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu;

/** The next place `word` stands as a whole word of `shown` at or after `from`, within reach. */
function findWord(shown: string, word: string, from: number): number {
  let found = shown.indexOf(word, from);
  while (found !== -1 && found - from <= MAX_SKIP) {
    // "a" is not found inside "example", nor "amp" at the head of "amplifier".
    const before = found === 0 ? "" : (shown[found - 1] ?? "");
    const after = shown[found + word.length] ?? "";
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return found;
    found = shown.indexOf(word, found + 1);
  }
  return -1;
}

/** Punctuation is only taken where it is the very next thing shown: a stray "." is everywhere. */
function findMark(shown: string, mark: string, from: number): number {
  let next = from;
  while (next < shown.length && /\s/.test(shown[next] ?? "")) next++;
  return shown.startsWith(mark, next) ? next : -1;
}

/** For each character of `spoken`, its index in `shown`, or -1 where it is not on screen. */
export function alignSpoken(spoken: string, shown: string): Int32Array {
  const at = new Int32Array(spoken.length).fill(-1);
  // Case is ignored, unless lowercasing changes a length and would shift every index after it.
  const fold = spoken.toLowerCase().length === spoken.length && shown.toLowerCase().length === shown.length;
  const needles = fold ? spoken.toLowerCase() : spoken;
  const haystack = fold ? shown.toLowerCase() : shown;
  let pointer = 0;
  for (const piece of needles.matchAll(PIECE)) {
    const text = piece[0];
    const found = WORD_CHARACTER.test(text) ? findWord(haystack, text, pointer) : findMark(haystack, text, pointer);
    if (found === -1) continue;
    for (let k = 0; k < text.length; k++) at[piece.index + k] = found + k;
    pointer = found + text.length;
  }
  return at;
}

export interface SectionSpoken {
  /** The section's passages, a space between each. */
  text: string;
  /** `source[i]` is the note offset of `text[i]`, or -1 for the space between passages. */
  source: number[];
}

/** What is spoken from the note range `[from, to)`: one rendered section. */
export function sectionSpoken(passages: readonly Passage[], from: number, to: number): SectionSpoken {
  const out: SectionSpoken = { text: "", source: [] };
  for (const passage of passages) {
    const start = passage.map[0];
    if (start === undefined || start < from || start >= to) continue;
    if (out.text !== "") {
      out.text += " ";
      out.source.push(-1);
    }
    out.text += passage.text;
    out.source.push(...passage.map);
  }
  return out;
}

/** The stretch of shown text behind a note range, from its first character found to its last. */
export function shownSpan(spoken: SectionSpoken, at: Int32Array, range: SourceRange): SourceRange | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < spoken.source.length; i++) {
    const offset = spoken.source[i] ?? -1;
    const shown = at[i] ?? -1;
    if (offset < range.from || offset >= range.to || shown === -1) continue;
    if (first === -1) first = shown;
    last = shown;
  }
  return first === -1 ? null : { from: first, to: last + 1 };
}
