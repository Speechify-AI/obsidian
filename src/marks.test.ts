import { describe, expect, it } from "vitest";
import { fillGaps, flattenMarks, markAtTime, sentenceRanges, timeSentences, toCodeUnits } from "./marks.ts";

/** Shape the live API returns: a "sentence" node holding "word" chunks. */
const word = (start: number, end: number, startMs: number, endMs: number) => ({
  type: "word",
  start,
  end,
  start_time: startMs,
  end_time: endMs,
});

describe("flattenMarks", () => {
  it("pulls word chunks out of the nested tree in reading order", () => {
    const raw = {
      type: "sentence",
      start: 0,
      end: 12,
      chunks: [word(4, 9, 213, 512), word(0, 3, 0, 213)],
    };
    expect(flattenMarks(raw)).toEqual([
      { start: 0, end: 3, startMs: 0, endMs: 213 },
      { start: 4, end: 9, startMs: 213, endMs: 512 },
    ]);
  });

  it("ignores chunks missing offsets rather than emitting NaN ranges", () => {
    const raw = { chunks: [{ type: "word", value: "x" }, word(0, 1, 0, 10)] };
    expect(flattenMarks(raw)).toEqual([{ start: 0, end: 1, startMs: 0, endMs: 10 }]);
  });

  it("survives an empty or absent marks payload", () => {
    expect(flattenMarks(undefined)).toEqual([]);
    expect(flattenMarks({ chunks: [] })).toEqual([]);
  });
});

describe("fillGaps", () => {
  it("leaves a whitespace-only gap alone", () => {
    const text = "The queue";
    const marks = [
      { start: 0, end: 3, startMs: 0, endMs: 200 },
      { start: 4, end: 9, startMs: 200, endMs: 500 },
    ];
    expect(fillGaps(marks, text)).toEqual(marks);
  });

  it("absorbs a dropped word forward, into the mark whose audio speaks it", () => {
    // Offsets and times below are the live response for this exact string
    // (simba-3.2 / harper_32, 2026-09-04). The API gave no mark at all for
    // "(" or "Thursday", and handed ")" a 682ms window — long enough to be
    // "Thursday)" being spoken, which is why the gap belongs to ")".
    const text = "Dr. Smith paid $4,200.50 on 2026-09-04 (a Thursday) -- see item #3.";
    const marks = [
      { start: 28, end: 38, startMs: 3883, endMs: 5888 }, // "2026-09-04"
      { start: 40, end: 41, startMs: 5888, endMs: 6059 }, // "a"
      { start: 50, end: 51, startMs: 6059, endMs: 6741 }, // ")"
      { start: 52, end: 53, startMs: 6741, endMs: 6997 }, // "-"
    ];
    const filled = fillGaps(marks, text);
    // The unmarked "(" is swept forward into "a" by the same rule.
    expect(text.slice(filled[1]!.start, filled[1]!.end)).toBe(" (a");
    // ")" grows backwards over the word nobody marked.
    expect(text.slice(filled[2]!.start, filled[2]!.end)).toBe(" Thursday)");
    // At 6100ms the audio is saying "Thursday", and the highlight now has it.
    const playing = markAtTime(filled, 6100)!;
    expect(text.slice(playing.start, playing.end)).toContain("Thursday");
  });

  it("covers the paragraph from end to end once gaps are closed", () => {
    const text = "Dr. Smith paid $4,200.50 on 2026-09-04 (a Thursday) -- see item #3.";
    const marks = [
      { start: 0, end: 9, startMs: 0, endMs: 853 },
      { start: 40, end: 41, startMs: 5888, endMs: 6059 },
      { start: 59, end: 66, startMs: 7381, endMs: 8448 },
    ];
    const filled = fillGaps(marks, text);
    expect(filled[0]!.start).toBe(0);
    expect(filled[filled.length - 1]!.end).toBe(text.length);
    // No hole holding real text survives.
    for (let i = 0; i < filled.length - 1; i++) {
      expect(text.slice(filled[i]!.end, filled[i + 1]!.start).trim()).toBe("");
    }
  });

  it("pulls the first mark back and pushes the last one out to cover the text", () => {
    const text = "Hello there world";
    const marks = [{ start: 6, end: 11, startMs: 0, endMs: 100 }];
    const filled = fillGaps(marks, text);
    expect(filled[0]).toEqual({ start: 0, end: text.length, startMs: 0, endMs: 100 });
  });

  it("clips overlapping times so the playhead cannot match two marks", () => {
    const text = "a b";
    const marks = [
      { start: 0, end: 1, startMs: 0, endMs: 500 },
      { start: 2, end: 3, startMs: 300, endMs: 600 },
    ];
    expect(fillGaps(marks, text)[0]!.endMs).toBe(300);
  });

  it("returns nothing for no marks", () => {
    expect(fillGaps([], "text")).toEqual([]);
  });
});

describe("markAtTime", () => {
  const marks = [
    { start: 0, end: 3, startMs: 0, endMs: 200 },
    { start: 4, end: 9, startMs: 200, endMs: 500 },
    { start: 10, end: 14, startMs: 500, endMs: 900 },
  ];

  it("finds the mark covering the playhead", () => {
    expect(markAtTime(marks, 0)?.start).toBe(0);
    expect(markAtTime(marks, 199)?.start).toBe(0);
    expect(markAtTime(marks, 200)?.start).toBe(4);
    expect(markAtTime(marks, 700)?.start).toBe(10);
  });

  it("returns null past the end of the last mark", () => {
    expect(markAtTime(marks, 1000)).toBeNull();
  });

  it("returns null on empty marks", () => {
    expect(markAtTime([], 10)).toBeNull();
  });
});

describe("sentenceRanges", () => {
  const slice = (text: string) => sentenceRanges(text).map((r) => text.slice(r.start, r.end).trim());

  it("splits on terminal punctuation", () => {
    expect(slice("One thing. Two things! Three?")).toEqual(["One thing.", "Two things!", "Three?"]);
  });

  it("keeps abbreviations and initials whole", () => {
    expect(slice("Dr. Smith paid up. He left.")).toEqual(["Dr. Smith paid up.", "He left."]);
    expect(slice("See e.g. the docs. Then stop.")).toEqual(["See e.g. the docs.", "Then stop."]);
    expect(slice("J. R. Hartley wrote it.")).toEqual(["J. R. Hartley wrote it."]);
  });

  it("does not split inside a decimal number", () => {
    expect(slice("We measured 6.9 times realtime. Good.")).toEqual([
      "We measured 6.9 times realtime.",
      "Good.",
    ]);
  });

  it("absorbs a closing quote into the sentence that ends", () => {
    expect(slice(`He said "stop." She did.`)).toEqual([`He said "stop."`, "She did."]);
  });

  it("handles text with no terminal punctuation as one sentence", () => {
    expect(slice("just a fragment")).toEqual(["just a fragment"]);
  });

  it("returns nothing for blank text", () => {
    expect(sentenceRanges("   ")).toEqual([]);
  });
});

describe("timeSentences", () => {
  it("spans each sentence over the marks inside it", () => {
    const text = "One two. Three four.";
    const marks = [
      { start: 0, end: 3, startMs: 0, endMs: 100 },
      { start: 4, end: 8, startMs: 100, endMs: 250 },
      { start: 9, end: 14, startMs: 250, endMs: 400 },
      { start: 15, end: 20, startMs: 400, endMs: 600 },
    ];
    expect(timeSentences(text, marks)).toEqual([
      { start: 0, end: 8, startMs: 0, endMs: 250 },
      { start: 8, end: 20, startMs: 250, endMs: 600 },
    ]);
  });

  it("stays monotonic when a sentence has no marks of its own", () => {
    const text = "Spoken. ... Spoken again.";
    const marks = [
      { start: 0, end: 7, startMs: 0, endMs: 300 },
      { start: 12, end: 25, startMs: 400, endMs: 900 },
    ];
    const timed = timeSentences(text, marks);
    for (let i = 1; i < timed.length; i++) {
      expect(timed[i]!.startMs).toBeGreaterThanOrEqual(timed[i - 1]!.endMs);
    }
  });
});

describe("toCodeUnits", () => {
  // The live case, 2026-10-01: offsets as the API returned them, in code points.
  const text = "A café 😀 with déjà vu.";
  const fromApi = [
    { start: 0, end: 1, startMs: 0, endMs: 100 },
    { start: 2, end: 6, startMs: 100, endMs: 400 },
    { start: 9, end: 13, startMs: 500, endMs: 700 },
    { start: 14, end: 18, startMs: 700, endMs: 1000 },
    { start: 19, end: 22, startMs: 1000, endMs: 1300 },
  ];

  it("shifts every mark after a character outside the BMP", () => {
    const marks = toCodeUnits(fromApi, text);
    expect(marks.map((m) => text.slice(m.start, m.end))).toEqual(["A", "café", "with", "déjà", "vu."]);
    expect(marks.map((m) => m.startMs)).toEqual(fromApi.map((m) => m.startMs));
  });

  it("leaves text without such characters alone", () => {
    const plain = "A café with déjà vu.";
    const marks = [{ start: 2, end: 6, startMs: 0, endMs: 1 }];
    expect(toCodeUnits(marks, plain)).toEqual(marks);
  });

  it("clamps an offset past the end of the text", () => {
    expect(toCodeUnits([{ start: 0, end: 99, startMs: 0, endMs: 1 }], "😀 hi")[0]!.end).toBe(5);
  });
});
