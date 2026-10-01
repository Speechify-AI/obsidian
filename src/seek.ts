/** Where the playhead is among a passage's sentences, and where a skip lands. */
import type { TimedRange } from "./marks.ts";

/** Index of the sentence playing at `ms`: the last one that has started. */
export function sentenceAtTime(sentences: readonly TimedRange[], ms: number): number {
  let index = 0;
  for (let i = 0; i < sentences.length; i++) {
    if ((sentences[i]?.startMs ?? Infinity) <= ms) index = i;
  }
  return index;
}

/** Index of the sentence holding spoken offset `offset`, or the next one after it. */
export function sentenceAtOffset(sentences: readonly TimedRange[], offset: number): number {
  const index = sentences.findIndex((s) => offset < s.end);
  return index === -1 ? Math.max(0, sentences.length - 1) : index;
}

/** Back restarts the sentence unless it has only just begun. */
export const RESTART_AFTER_MS = 1500;

/**
 * Where a skip lands: a sentence index in this passage, or the passage
 * before or after it.
 */
export function skipTarget(
  sentences: readonly TimedRange[],
  ms: number,
  direction: 1 | -1,
): number | "previous" | "next" {
  const current = sentenceAtTime(sentences, ms);
  if (direction === 1) return current + 1 < sentences.length ? current + 1 : "next";
  if (ms - (sentences[current]?.startMs ?? 0) > RESTART_AFTER_MS) return current;
  return current > 0 ? current - 1 : "previous";
}
