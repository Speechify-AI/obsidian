import { describe, expect, it } from "vitest";
import type { TimedRange } from "./marks.ts";
import { sentenceAtOffset, sentenceAtTime, skipTarget } from "./seek.ts";

const sentences: TimedRange[] = [
  { start: 0, end: 10, startMs: 0, endMs: 2000 },
  { start: 10, end: 25, startMs: 2100, endMs: 5000 },
  { start: 25, end: 40, startMs: 5200, endMs: 9000 },
];

describe("sentenceAtTime and sentenceAtOffset", () => {
  it("finds the sentence that has started, including in the pause after it", () => {
    expect(sentenceAtTime(sentences, 0)).toBe(0);
    expect(sentenceAtTime(sentences, 2050)).toBe(0);
    expect(sentenceAtTime(sentences, 2100)).toBe(1);
    expect(sentenceAtTime(sentences, 99999)).toBe(2);
    expect(sentenceAtTime([], 100)).toBe(0);
  });

  it("finds the sentence holding an offset", () => {
    expect(sentenceAtOffset(sentences, 0)).toBe(0);
    expect(sentenceAtOffset(sentences, 10)).toBe(1);
    expect(sentenceAtOffset(sentences, 39)).toBe(2);
    expect(sentenceAtOffset(sentences, 400)).toBe(2);
  });
});

describe("skipTarget", () => {
  it("goes forward a sentence, then to the next passage", () => {
    expect(skipTarget(sentences, 500, 1)).toBe(1);
    expect(skipTarget(sentences, 6000, 1)).toBe("next");
  });

  it("goes back to the start of the sentence once it is under way", () => {
    expect(skipTarget(sentences, 4000, -1)).toBe(1);
  });

  it("goes back a sentence when this one has only just begun, then to the previous passage", () => {
    expect(skipTarget(sentences, 2600, -1)).toBe(0);
    expect(skipTarget(sentences, 800, -1)).toBe("previous");
  });
});
