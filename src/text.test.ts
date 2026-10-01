import { describe, expect, it } from "vitest";
import { chunkRanges } from "./text.ts";

describe("chunkRanges", () => {
  const chunks = (text: string, limit: number) =>
    chunkRanges(text, limit).map((r) => text.slice(r.start, r.end));

  it("leaves text inside the limit as one range", () => {
    expect(chunkRanges("Short.", 100)).toEqual([{ start: 0, end: 6 }]);
  });

  it("returns nothing for empty text", () => {
    expect(chunkRanges("", 100)).toEqual([]);
  });

  it("prefers a sentence boundary", () => {
    const text = `${"a".repeat(40)}. ${"b".repeat(40)}.`;
    expect(chunks(text, 50)[0]).toBe(`${"a".repeat(40)}. `);
  });

  it("falls back to a word boundary when no sentence fits", () => {
    const text = "word ".repeat(30).trim();
    expect(chunks(text, 50).every((c) => c.length <= 50)).toBe(true);
  });

  it("hard cuts a single token longer than the limit", () => {
    expect(chunks("x".repeat(120), 50).every((c) => c.length <= 50)).toBe(true);
  });

  it("tiles the text end to end with no gaps or overlaps", () => {
    const text = `${"Sentence here. ".repeat(40)}${"tail ".repeat(20)}`.trim();
    const ranges = chunkRanges(text, 90);
    expect(ranges[0]!.start).toBe(0);
    expect(ranges[ranges.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.start).toBe(ranges[i - 1]!.end);
    }
    expect(ranges.map((r) => text.slice(r.start, r.end)).join("")).toBe(text);
    expect(ranges.every((r) => r.end - r.start <= 90)).toBe(true);
  });
});
