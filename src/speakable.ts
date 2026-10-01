/**
 * A note's markdown → the passages that are spoken, each with a source map.
 *
 * Readback and Soundbites flatten markdown and then display the flat text,
 * so what is shown is what is spoken. Here the note itself is the display,
 * so every spoken character has to know where it came from: `map[i]` is the
 * offset in the note of the character at `text[i]`. A speech mark's offsets
 * index `text`; the map turns them into a range the editor can decorate.
 *
 * Nothing is ever inserted. Every spoken character is a character of the
 * note (a newline inside a paragraph is spoken as a space, and maps to that
 * newline), so `map` is strictly increasing and a spoken range always has a
 * source range.
 *
 * What is not read: frontmatter, code blocks, math, comments, tables,
 * images and embeds, link targets, bare URLs, footnote markers, block ids,
 * and the markup characters themselves.
 */
import { chunkRanges } from "./text.ts";

export interface Passage {
  /** Exactly what is sent to the API. */
  text: string;
  /** `map[i]` is the note offset of `text[i]`. Same length as `text`. */
  map: number[];
}

/**
 * Longest passage sent as one request; longer blocks are cut at sentence
 * ends. Far under the API's 2,000 because /v1/audio/speech answers only when
 * the whole clip is made, and that is what you wait for after pressing play.
 * Measured 2026-10-01 (simba-3.2 / harper_32): 70 characters took 2.1 s, 300
 * took 4.1 s, 600 took 6.6 s and 1,900 took 16.9 s, so about 1.5 s plus 8 ms
 * a character, for speech about six times as long as the wait. At 200 the
 * first audio is about 3 s away and a look-ahead keeps up at any speed.
 */
export const PASSAGE_LIMIT = 200;

export function toPassages(source: string, limit = PASSAGE_LIMIT): Passage[] {
  const skip = skipFlags(source);
  const reader: Reader = { source, skip, limit, block: { text: "", map: [] }, out: [], inTable: false, inList: false };
  let lineStart = 0;
  while (lineStart <= source.length) {
    const lineEnd = endOfLine(source, lineStart);
    const nextEnd = lineEnd < source.length ? endOfLine(source, lineEnd + 1) : lineEnd;
    readLine(reader, lineStart, lineEnd, source.slice(lineEnd + 1, nextEnd));
    lineStart = lineEnd + 1;
  }
  flush(reader);
  return reader.out;
}

function endOfLine(source: string, from: number): number {
  const newline = source.indexOf("\n", from);
  return newline === -1 ? source.length : newline;
}

interface Reader {
  source: string;
  skip: Uint8Array;
  limit: number;
  /** The paragraph, heading or list item being read. */
  block: Passage;
  out: Passage[];
  /** Inside a table: every row is skipped until a line with no pipe. */
  inTable: boolean;
  /** Inside a list, where an indented line is the item's own text and not code. */
  inList: boolean;
}

/** End the current block and cut it into passages. */
function flush(reader: Reader): void {
  const whole = trimPassage(reader.block);
  reader.block = { text: "", map: [] };
  for (const range of chunkRanges(whole.text, reader.limit)) {
    const piece = trimPassage(slicePassage(whole, range.start, range.end));
    if (piece.text !== "") reader.out.push(piece);
  }
}

const QUOTE_PREFIX = /^[ \t]*(?:>[ \t]?)+/;
const CALLOUT = /^\[!([\w-]+)\][+-]?[ \t]*/;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/;
const HEADING_CLOSE = /[ \t]+#+[ \t]*$/;
const RULE = /^[ \t]*(?:([-*_])(?:[ \t]*\1){2,}|=+)[ \t]*$/;
/** The row under a table's header: "| --- | :-: |", outer pipes optional. */
const TABLE_DELIMITER = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$/;
const INDENTED = /^(?: {4}|\t)/;
const LINK_DEFINITION = /^[ \t]{0,3}\[[^\]^][^\]]*\]:[ \t]+\S/;
const FOOTNOTE_DEFINITION = /^[ \t]{0,3}\[\^[^\]]+\]:[ \t]*/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?/;
const BLOCK_ID = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/;

function readLine(reader: Reader, lineStart: number, lineEnd: number, nextLine: string): void {
  const { source, skip } = reader;
  if (isBlank(source, skip, lineStart, lineEnd)) {
    flush(reader);
    reader.inTable = false;
    return;
  }

  const whole = source.slice(lineStart, lineEnd);
  // A table is known by the delimiter row under its header, with or without
  // outer pipes, and runs until a line that has no pipe in it.
  const row = whole.replace(QUOTE_PREFIX, "");
  if (reader.inTable && !row.includes("|")) reader.inTable = false;
  if (!reader.inTable && row.includes("|") && TABLE_DELIMITER.test(nextLine.replace(QUOTE_PREFIX, ""))) {
    reader.inTable = true;
  }
  if (reader.inTable) {
    flush(reader);
    return;
  }

  // An indented line that starts a block is code, unless a list is open, where
  // it is the item carrying on. It cannot interrupt a paragraph.
  const item = LIST_ITEM.test(whole);
  if (INDENTED.test(whole) && reader.block.text === "" && !reader.inList && !item) return;
  if (item) reader.inList = true;
  else if (!isSpace(whole[0])) reader.inList = false;

  let from = lineStart;
  let to = lineEnd;
  const rest = (): string => source.slice(from, to);
  /** This line is a block of its own: a heading or a callout title. */
  let alone = false;
  /** This line starts a new block: a list item or a footnote. */
  let starts = false;

  const quote = QUOTE_PREFIX.exec(rest());
  if (quote) {
    from += quote[0].length;
    const callout = CALLOUT.exec(rest());
    if (callout) {
      // "[!note] Title" reads the title; a bare "[!note]" reads its type,
      // which is what Obsidian shows as the title.
      const titled = rest().slice(callout[0].length).trim() !== "";
      if (titled) from += callout[0].length;
      else {
        from += 2;
        to = from + (callout[1]?.length ?? 0);
      }
      alone = true;
    }
  }

  if (!alone) {
    const line = rest();
    if (RULE.test(line) || LINK_DEFINITION.test(line)) {
      flush(reader);
      return;
    }
    const heading = HEADING.exec(line);
    const opener = heading ? null : (FOOTNOTE_DEFINITION.exec(line) ?? LIST_ITEM.exec(line));
    if (heading) {
      from += heading[0].length;
      to -= HEADING_CLOSE.exec(rest())?.[0].length ?? 0;
      alone = true;
    } else if (opener) {
      from += opener[0].length;
      starts = true;
    }
  }

  to -= BLOCK_ID.exec(rest())?.[0].length ?? 0;

  if (alone || starts) flush(reader);
  // A line that continues a paragraph is joined to it by its own newline.
  else if (reader.block.text !== "") emit(reader.block, " ", lineStart - 1);
  speakInline(source, skip, from, to, reader.block);
  if (alone) flush(reader);
}

function isBlank(source: string, skip: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (skip[i] === 0 && !isSpace(source[i])) return false;
  }
  return true;
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === " ";
}

/** Append one character. Runs of whitespace become one space; none leads a block. */
function emit(block: Passage, ch: string, sourceOffset: number): void {
  if (isSpace(ch)) {
    if (block.text === "" || block.text.endsWith(" ")) return;
    block.text += " ";
  } else {
    block.text += ch;
  }
  block.map.push(sourceOffset);
}

function slicePassage(passage: Passage, start: number, end: number): Passage {
  return { text: passage.text.slice(start, end), map: passage.map.slice(start, end) };
}

function trimPassage(passage: Passage): Passage {
  const start = passage.text.length - passage.text.trimStart().length;
  const end = passage.text.trimEnd().length;
  return start === 0 && end === passage.text.length ? passage : slicePassage(passage, start, Math.max(start, end));
}

// ---- what is skipped wholesale --------------------------------------------

const FENCE_OPEN = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*$/;
const FRONTMATTER_END = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * One flag per character of the note: 1 means never read. Covers the
 * regions that span lines (frontmatter, fenced code, math blocks, comments);
 * everything inline is decided in `speakInline`.
 */
function skipFlags(source: string): Uint8Array {
  const skip = new Uint8Array(source.length);
  const lines = source.split("\n");
  // Frontmatter only counts when it is closed; a lone "---" is a rule.
  let frontmatter =
    lines[0]?.trimEnd() === "---" && lines.slice(1).some((line) => FRONTMATTER_END.test(line));
  let fence: string | null = null;
  let offset = 0;

  lines.forEach((line, index) => {
    const end = offset + line.length;
    if (frontmatter) {
      skip.fill(1, offset, end);
      if (index > 0 && FRONTMATTER_END.test(line)) frontmatter = false;
    } else if (fence !== null) {
      skip.fill(1, offset, end);
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
    } else {
      const open = FENCE_OPEN.exec(line)?.[1];
      if (open) {
        fence = open;
        skip.fill(1, offset, end);
      }
    }
    offset = end + 1;
  });

  // Regions found by pattern. One that starts inside code is not a region.
  for (const pattern of [/\$\$[\s\S]*?\$\$/g, /%%[\s\S]*?%%/g, /<!--[\s\S]*?-->/g]) {
    for (const match of source.matchAll(pattern)) {
      if (skip[match.index] === 0) skip.fill(1, match.index, match.index + match[0].length);
    }
  }
  return skip;
}

// ---- inline markup ---------------------------------------------------------

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const IMAGE = /!\[(?:\\.|[^\]\\])*\]\((?:\\.|[^)\\])*\)|!\[\[[^\]\n]*\]\]/y;
const WIKILINK = /\[\[([^\]\n]+?)\]\]/y;
const FOOTNOTE_MARKER = /\[\^[^\]\s]+\]/y;
const LINK = /\[((?:\\.|[^\]\\])*)\]\((?:\\.|[^)\\])*\)/y;
const REFERENCE_LINK = /\[((?:\\.|[^\]\\])*)\]\[[^\]\n]*\]/y;
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^>\s]+>/y;
const HTML_TAG = /<\/?[A-Za-z][^>\n]*>/y;
const URL = /https?:\/\/[^\s<>]+/y;
const INLINE_MATH = /\$(?!\s)[^$\n]*?(?<!\s)\$(?!\d)/y;

function matchAt(pattern: RegExp, source: string, at: number, limit: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  const match = pattern.exec(source);
  return match && at + match[0].length <= limit ? match : null;
}

/** Read `source[from, to)` into `block`, dropping markup and keeping its text. */
function speakInline(source: string, skip: Uint8Array, from: number, to: number, block: Passage): void {
  let i = from;
  while (i < to) {
    if (skip[i] === 1) {
      i++;
      continue;
    }
    const ch = source[i] ?? "";
    const prev = i > from ? source[i - 1] : undefined;
    const next = i + 1 < to ? source[i + 1] : undefined;

    if (ch === "\\" && next !== undefined && ESCAPABLE.test(next)) {
      emit(block, next, i + 1);
      i += 2;
      continue;
    }

    if (ch === "`") {
      const run = runLength(source, i, to, "`");
      const close = source.indexOf("`".repeat(run), i + run);
      if (close !== -1 && close + run <= to) {
        for (let j = i + run; j < close; j++) emit(block, source[j] ?? "", j);
        i = close + run;
      } else {
        i += run;
      }
      continue;
    }

    if (ch === "!" && next === "[") {
      const image = matchAt(IMAGE, source, i, to);
      if (image) {
        i += image[0].length;
        continue;
      }
    }

    if (ch === "[") {
      const wikilink = matchAt(WIKILINK, source, i, to);
      if (wikilink) {
        const [start, end] = wikilinkText(wikilink[1] ?? "", i + 2);
        for (let j = start; j < end; j++) emit(block, source[j] ?? "", j);
        i += wikilink[0].length;
        continue;
      }
      const marker = matchAt(FOOTNOTE_MARKER, source, i, to);
      if (marker) {
        i += marker[0].length;
        continue;
      }
      const link = matchAt(LINK, source, i, to) ?? matchAt(REFERENCE_LINK, source, i, to);
      if (link) {
        speakInline(source, skip, i + 1, i + 1 + (link[1]?.length ?? 0), block);
        i += link[0].length;
        continue;
      }
    }

    if (ch === "<") {
      const tag = matchAt(AUTOLINK, source, i, to) ?? matchAt(HTML_TAG, source, i, to);
      if (tag) {
        i += tag[0].length;
        continue;
      }
    }

    if (ch === "h" && (prev === undefined || !/\w/.test(prev))) {
      const url = matchAt(URL, source, i, to);
      if (url) {
        // Punctuation that ends the sentence is not part of the address.
        i += url[0].replace(/[.,;:!?)\]'"]+$/, "").length;
        continue;
      }
    }

    if (ch === "$") {
      const math = matchAt(INLINE_MATH, source, i, to);
      if (math) {
        i += math[0].length;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~" || ch === "=") {
      const run = runLength(source, i, to, ch);
      const after = i + run < to ? source[i + run] : undefined;
      if (isDelimiter(ch, run, prev, after)) {
        i += run;
        continue;
      }
    }

    // A tag reads as its name.
    if (ch === "#" && isSpace(prev) && next !== undefined && /[\p{L}_]/u.test(next)) {
      i++;
      continue;
    }

    emit(block, ch, i);
    i++;
  }
}

function runLength(source: string, at: number, limit: number, ch: string): number {
  let end = at;
  while (end < limit && source[end] === ch) end++;
  return end - at;
}

/**
 * Is this run of `*`, `_`, `~` or `=` emphasis markup rather than text?
 * Markup hugs a word on at least one side: "2 * 3" and "a == b" are text.
 * An underscore inside a word (snake_case) is text too.
 */
function isDelimiter(ch: string, run: number, prev: string | undefined, after: string | undefined): boolean {
  if ((ch === "~" || ch === "=") && run !== 2) return false;
  if (isSpace(prev) && isSpace(after)) return false;
  if (ch === "_" && prev !== undefined && after !== undefined && /\w/.test(prev) && /\w/.test(after)) return false;
  return true;
}

/**
 * The part of a wikilink that Obsidian shows, as offsets into the note.
 * `[[Note|alias]]` shows the alias, `[[Note#Heading]]` reads the note name,
 * and `[[#Heading]]` the heading. `innerStart` is where `inner` begins.
 */
function wikilinkText(inner: string, innerStart: number): [number, number] {
  const pipe = inner.indexOf("|");
  if (pipe !== -1) return [innerStart + pipe + 1, innerStart + inner.length];
  const hash = inner.indexOf("#");
  if (hash === -1) return [innerStart, innerStart + inner.length];
  if (hash > 0) return [innerStart, innerStart + hash];
  const heading = inner.startsWith("#^") ? inner.length : 1;
  return [innerStart + heading, innerStart + inner.length];
}

// ---- spoken offsets ↔ note offsets -----------------------------------------

export interface SourceRange {
  from: number;
  to: number;
}

/** The note range behind `text[start, end)`, markup in between included. */
export function sourceRange(passage: Passage, start: number, end: number): SourceRange | null {
  const from = passage.map[start];
  const last = passage.map[end - 1];
  if (from === undefined || last === undefined || end <= start) return null;
  return { from, to: last + 1 };
}

/** The first spoken offset at or after note offset `position`; `text.length` if none. */
export function spokenOffsetAt(passage: Passage, position: number): number {
  let low = 0;
  let high = passage.map.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((passage.map[mid] ?? 0) < position) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Index of the first passage with anything at or after note offset `position`, or -1. */
export function passageIndexAt(passages: readonly Passage[], position: number): number {
  return passages.findIndex((p) => (p.map[p.map.length - 1] ?? -1) >= position);
}

/** Only what lies inside the note range `[from, to)`: a selection. */
export function clipPassages(passages: readonly Passage[], from: number, to: number): Passage[] {
  const out: Passage[] = [];
  for (const passage of passages) {
    const start = spokenOffsetAt(passage, from);
    const end = spokenOffsetAt(passage, to);
    if (end <= start) continue;
    const piece = trimPassage(slicePassage(passage, start, end));
    if (piece.text !== "") out.push(piece);
  }
  return out;
}
