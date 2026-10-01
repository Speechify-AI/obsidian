import { describe, expect, it } from "vitest";
import {
  checkKey,
  describeVoice,
  languageName,
  listVoices,
  matchesVoice,
  normalizeVoicePage,
  sortVoices,
  synthesize,
  toVoice,
  TtsError,
  voiceTraits,
  type Http,
  type HttpRequest,
} from "./speechify.ts";

describe("toVoice", () => {
  it("keeps what the picker groups and samples by", () => {
    const v = toVoice(
      {
        id: "harper_32",
        display_name: "Harper",
        locale: "en-US",
        type: "shared",
        gender: "female",
        tags: ["narrator", "", 3],
        preview_audio: null,
        models: [
          { name: "simba-3.0", languages: [{ locale: "en-US", preview_audio: "https://x/old.mp3" }] },
          { name: "simba-3.2", languages: [{ locale: "en-US", preview_audio: "https://x/new.mp3" }] },
        ],
      },
      "simba-3.2",
    );
    expect(v).toEqual({
      id: "harper_32",
      name: "Harper",
      locale: "en-US",
      cloned: false,
      gender: "female",
      tags: ["narrator"],
      preview: "https://x/new.mp3",
      featured: true,
    });
  });

  it("features the roster suffix on simba-3.2 only, never a clone", () => {
    expect(toVoice({ id: "wyatt_32" }, "simba-3.2")?.featured).toBe(true);
    expect(toVoice({ id: "wyatt_32" }, "simba-3.0")?.featured).toBe(false);
    expect(toVoice({ id: "wyatt" }, "simba-3.2")?.featured).toBe(false);
    expect(toVoice({ id: "mine_32", type: "personal" }, "simba-3.2")?.featured).toBe(false);
  });

  it("prefers the voice's own preview, and has none when the catalogue has none", () => {
    expect(toVoice({ id: "a", preview_audio: "https://x/a.mp3", models: [] })?.preview).toBe("https://x/a.mp3");
    const bare = toVoice({ id: "b", type: "personal", gender: "not_specified" });
    expect(bare).toMatchObject({ name: "b", cloned: true, gender: "unspecified", tags: [], preview: null, featured: false });
    expect(toVoice({})).toBeNull();
  });
});

describe("normalizeVoicePage and sortVoices", () => {
  it("reads both response shapes and orders featured, shared, clones", () => {
    expect(normalizeVoicePage([{ id: "a" }]).rows).toHaveLength(1);
    expect(normalizeVoicePage({ voices: [{ id: "a" }], next_cursor: "c", has_more: true }).cursor).toBe("c");
    const m = "simba-3.2";
    const voices = [toVoice({ id: "z", type: "personal" }, m)!, toVoice({ id: "b" }, m)!, toVoice({ id: "a" }, m)!, toVoice({ id: "wyatt_32" }, m)!];
    expect(sortVoices(voices).map((v) => v.id)).toEqual(["wyatt_32", "a", "b", "z"]);
  });
});

const base = { apiBase: "https://api.test", apiKey: "k".repeat(24), model: "simba-3.2" };

describe("synthesize", () => {
  it("posts the passage and decodes audio and marks", async () => {
    const seen: HttpRequest[] = [];
    const http: Http = async (request) => {
      seen.push(request);
      return {
        status: 200,
        text: JSON.stringify({
          audio_data: btoa("ÿûaudio"),
          billable_characters_count: 5,
          speech_marks: { type: "sentence", chunks: [{ type: "word", start: 0, end: 5, start_time: 0, end_time: 300 }] },
        }),
      };
    };
    const out = await synthesize("Hello", { ...base, voiceId: "harper_32", http });
    expect(seen[0]!.url).toBe("https://api.test/v1/audio/speech");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ input: "Hello", voice_id: "harper_32", model: "simba-3.2", audio_format: "mp3" });
    expect(Array.from(out.audio.slice(0, 2))).toEqual([0xff, 0xfb]);
    expect(out.charsBilled).toBe(5);
    expect(out.marks).toEqual([{ start: 0, end: 5, startMs: 0, endMs: 300 }]);
  });

  it("throws the status and body on a refusal, without retrying", async () => {
    let calls = 0;
    const http: Http = async () => {
      calls++;
      return { status: 402, text: "out of credit" };
    };
    await expect(synthesize("Hello", { ...base, voiceId: "v", http })).rejects.toMatchObject({ status: 402 });
    expect(calls).toBe(1);
  });

  it("refuses a 200 that is not the expected JSON", async () => {
    const http: Http = async () => ({ status: 200, text: "<html>" });
    await expect(synthesize("Hello", { ...base, voiceId: "v", http })).rejects.toBeInstanceOf(TtsError);
  });
});

describe("listVoices and checkKey", () => {
  const page = (ids: string[], cursor: string | null) =>
    JSON.stringify({
      voices: ids.map((id) => ({ id, models: [{ name: id.startsWith("old") ? "simba-3.0" : "simba-3.2" }] })),
      has_more: cursor !== null,
      next_cursor: cursor,
    });

  it("walks every page and keeps only voices that render the model", async () => {
    const urls: string[] = [];
    const http: Http = async ({ url }) => {
      urls.push(url);
      return { status: 200, text: url.includes("cursor=c2") ? page(["b_32"], null) : page(["a", "old"], "c2") };
    };
    const voices = await listVoices({ ...base, http });
    expect(voices.map((v) => v.id)).toEqual(["b_32", "a"]);
    expect(urls).toHaveLength(2);
  });

  it("says why a key was refused", async () => {
    const refused: Http = async () => ({ status: 401, text: "" });
    expect(await checkKey("k".repeat(24), base.apiBase, base.model, refused)).toEqual({
      ok: false,
      reason: "Speechify refused that key.",
    });
    expect((await checkKey("short", base.apiBase, base.model, refused)).ok).toBe(false);
  });
});

describe("describeVoice and matchesVoice", () => {
  // Tags as the catalogue sends them (2026-10-01), trimmed.
  const harper = toVoice(
    {
      id: "harper_32",
      display_name: "Harper",
      locale: "en-US",
      gender: "female",
      tags: ["gender:female", "label:new-voice", "use-case:audiobook-long-form", "age:young-adult", "style:playful", "timbre:soft"],
    },
    "simba-3.2",
  )!;

  it("shows what the voice sounds like, not its twenty use cases", () => {
    expect(describeVoice(harper)).toBe("en-US · female · young adult · playful · soft");
    expect(describeVoice(toVoice({ id: "mine", type: "personal" })!)).toBe("your clone");
    expect(voiceTraits(harper)).toEqual(["young adult", "playful", "soft"]);
  });

  it("names a locale the way people say it, and passes on one it cannot name", () => {
    expect(languageName("en-GB")).toBe("British English");
    expect(languageName("")).toBe("");
    expect(languageName("not a locale")).toBe("not a locale");
    expect(matchesVoice(harper, "american english")).toBe(true);
  });

  it("matches every search term against the start of a word, hidden tags included", () => {
    expect(matchesVoice(harper, "")).toBe(true);
    expect(matchesVoice(harper, "harp")).toBe(true);
    expect(matchesVoice(harper, "female audiobook")).toBe(true);
    expect(matchesVoice(harper, "en-us young")).toBe(true);
    expect(matchesVoice(harper, "british")).toBe(false);
    // "male" is inside "female"; it must not match it.
    expect(matchesVoice(harper, "male")).toBe(false);
  });
});
