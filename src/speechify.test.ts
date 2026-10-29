import { describe, expect, it } from "vitest";
import {
  CALLER,
  checkKey,
  describeVoice,
  languageName,
  listVoices,
  matchesVoice,
  nativeVoice,
  normalizeVoicePage,
  speaksNatively,
  sortVoices,
  synthesize,
  toVoice,
  TtsError,
  voiceTraits,
  withCaller,
  type Http,
  type HttpRequest,
  type Voice,
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
        avatar_image: "https://x/harper.webp",
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
      avatar: "https://x/harper.webp",
      featured: true,
      staffPick: null,
    });
    expect(toVoice({ id: "romain-agent", staff_pick_rank: 2 })?.staffPick).toBe(2);
  });

  it("features the roster suffix on simba-3.2 and simba-3.5 only, never a clone", () => {
    expect(toVoice({ id: "wyatt_32" }, "simba-3.2")?.featured).toBe(true);
    expect(toVoice({ id: "wyatt_32" }, "simba-3.5")?.featured).toBe(true);
    expect(toVoice({ id: "wyatt_32" }, "simba-3.0")?.featured).toBe(false);
    expect(toVoice({ id: "wyatt" }, "simba-3.2")?.featured).toBe(false);
    expect(toVoice({ id: "mine_32", type: "personal" }, "simba-3.2")?.featured).toBe(false);
  });

  it("prefers the voice's own preview, and has none when the catalogue has none", () => {
    expect(toVoice({ id: "a", preview_audio: "https://x/a.mp3", models: [] })?.preview).toBe("https://x/a.mp3");
    const bare = toVoice({ id: "b", type: "personal", gender: "not_specified" });
    expect(bare).toMatchObject({ name: "b", cloned: true, gender: "unspecified", tags: [], preview: null, avatar: null, featured: false });
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

describe("nativeVoice", () => {
  const voice = (id: string, locale: string, gender: Voice["gender"], staffPick: number | null = null, cloned = false): Voice =>
    ({ id, name: id, locale, cloned, gender, tags: [], preview: null, avatar: null, featured: false, staffPick });
  const dominic = voice("dominic_32", "en-US", "male", 4);
  const harper = voice("harper_32", "en-US", "female", 1);
  const catalogue = [
    dominic,
    harper,
    voice("isabelle-agent", "fr-FR", "female", 1),
    voice("romain-agent", "fr-FR", "male", 2),
    voice("pierre", "fr-FR", "male"),
    voice("rafael", "pt-BR", "male", 1),
    voice("joana", "pt-PT", "female", 1),
    voice("tiago", "pt-PT", "male", 2),
    voice("lakan", "fil-PH", "male", 1),
    voice("mine", "fr-FR", "male", null, true),
  ];

  it("takes the staff pick of the voice's gender, else the top pick", () => {
    expect(nativeVoice("fr", catalogue, dominic)?.id).toBe("romain-agent");
    expect(nativeVoice("fr", catalogue, harper)?.id).toBe("isabelle-agent");
    expect(nativeVoice("pt", catalogue, harper)?.id).toBe("joana");
    expect(nativeVoice("fr", catalogue, voice("x", "en-US", "unspecified"))?.id).toBe("isabelle-agent");
  });

  it("goes to the region the language names before the gender", () => {
    expect(nativeVoice("pt-BR", catalogue, harper)?.id).toBe("rafael");
    expect(nativeVoice("pt-PT", catalogue, dominic)?.id).toBe("tiago");
  });

  it("keeps the voice for its own language, for a clone, and for a language with no voice", () => {
    expect(nativeVoice("en", catalogue, dominic)).toBeNull();
    expect(nativeVoice("en-GB", catalogue, dominic)).toBeNull();
    expect(nativeVoice("fr", catalogue, voice("me", "en-US", "male", null, true))).toBeNull();
    expect(nativeVoice("th", catalogue, dominic)).toBeNull();
  });

  it("never picks a clone, and knows Tagalog voices are filed under fil", () => {
    expect(nativeVoice("fr", [voice("mine", "fr-FR", "male", null, true), voice("pierre", "fr-FR", "male")], dominic)?.id).toBe("pierre");
    expect(nativeVoice("tl", catalogue, dominic)?.id).toBe("lakan");
    expect(speaksNatively("nb-NO", "no")).toBe(true);
  });
});

const base = { apiBase: "https://api.test", apiKey: "k".repeat(24), model: "simba-3.5" };

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
    expect(JSON.parse(seen[0]!.body!)).toEqual({ input: "Hello", voice_id: "harper_32", model: "simba-3.5", audio_format: "mp3" });
    expect(Array.from(out.audio.slice(0, 2))).toEqual([0xff, 0xfb]);
    expect(out.charsBilled).toBe(5);
    expect(out.marks).toEqual([{ start: 0, end: 5, startMs: 0, endMs: 300 }]);
  });

  it("names the language only when one is given", async () => {
    const seen: HttpRequest[] = [];
    const http: Http = async (request) => {
      seen.push(request);
      return { status: 200, text: JSON.stringify({ audio_data: btoa("x"), speech_marks: null }) };
    };
    await synthesize("Bonjour", { ...base, voiceId: "harper_32", language: "fr", http });
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ input: "Bonjour", language: "fr" });
    await synthesize("Hello", { ...base, voiceId: "harper_32", http });
    expect(JSON.parse(seen[1]!.body!)).not.toHaveProperty("language");
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

describe("withCaller", () => {
  it("names the plugin and its version on every request, beside the key", async () => {
    const seen: HttpRequest[] = [];
    const http = withCaller(async (request) => {
      seen.push(request);
      return { status: 200, text: JSON.stringify({ voices: [], has_more: false }) };
    }, "0.1.5");
    await listVoices({ ...base, http });
    await synthesize("Hello", { ...base, voiceId: "v", http }).catch(() => undefined);
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request.headers).toMatchObject({
        Authorization: `Bearer ${base.apiKey}`,
        "Speechify-Caller": "obsidian",
        "Speechify-Caller-Version": "0.1.5",
      });
    }
  });

  it("uses a slug the API accepts: lowercase, 40 characters at most", () => {
    expect(CALLER).toBe("obsidian");
    expect(CALLER).toMatch(/^[a-z0-9._-]{1,40}$/);
  });
});

describe("listVoices and checkKey", () => {
  const page = (ids: string[], cursor: string | null) =>
    JSON.stringify({
      voices: ids.map((id) => ({ id, models: [{ name: id.startsWith("old") ? "simba-3.2" : "simba-3.5" }] })),
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
