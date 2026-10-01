import { describe, expect, it } from "vitest";
import { memoryCache, renderKey, renderPassage } from "./render.ts";
import type { TtsConfig, TtsResult } from "./speechify.ts";

const cfg: TtsConfig = {
  apiBase: "http://x",
  apiKey: "k",
  voiceId: "v",
  model: "m",
  http: async () => ({ status: 500, text: "" }),
};

/** A fake synth: one mark per word at 10ms per character, a few bytes of "audio". */
const fakeSynth = async (input: string): Promise<TtsResult> => {
  const marks = [];
  for (const m of input.matchAll(/\w+/g)) {
    marks.push({ start: m.index, end: m.index + m[0].length, startMs: m.index * 10, endMs: (m.index + m[0].length) * 10 });
  }
  return { audio: new Uint8Array(8).fill(0xff), charsBilled: input.length, marks };
};

describe("renderPassage", () => {
  it("closes the gaps in the marks so every character belongs to one", async () => {
    const text = "It was (a Thursday) then.";
    const out = await renderPassage(text, cfg, memoryCache(), fakeSynth);
    expect(out.marks[0]!.start).toBe(0);
    expect(out.marks[out.marks.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < out.marks.length; i++) {
      expect(text.slice(out.marks[i - 1]!.end, out.marks[i]!.start).trim()).toBe("");
    }
  });

  it("is a cache hit the second time and never synthesizes again", async () => {
    const cache = memoryCache();
    let calls = 0;
    const synth = async (input: string) => {
      calls++;
      return fakeSynth(input);
    };
    await renderPassage("Hello there.", cfg, cache, synth);
    await renderPassage("Hello there.", cfg, cache, synth);
    expect(calls).toBe(1);
  });

  it("keys on voice and model as well as text", async () => {
    const a = await renderKey("x", "harper_32", "simba-3.2");
    expect(await renderKey("x", "geffen_32", "simba-3.2")).not.toBe(a);
    expect(await renderKey("x", "harper_32", "simba-3.3")).not.toBe(a);
    expect(await renderKey("y", "harper_32", "simba-3.2")).not.toBe(a);
    expect(await renderKey("x", "harper_32", "simba-3.2")).toBe(a);
  });
});
