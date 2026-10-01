/**
 * Thin client for Speechify /v1/audio/speech and the voice catalogue. Copied
 * from Readback, with two changes for Obsidian: requests go through an
 * injected `Http` (the plugin passes Obsidian's `requestUrl`, which is not
 * subject to CORS and works on mobile), and base64 is decoded with `atob`
 * because there is no Node `Buffer` on mobile.
 *
 * That endpoint and not /v1/audio/stream, deliberately. Stream takes 20,000
 * characters against speech's 2,000, but returns raw audio and nothing else.
 * Read-along needs `speech_marks`, and only /speech returns them.
 * /v1/audio/stream/with-timestamps returns them too, but as server-sent
 * events that `requestUrl` cannot stream.
 */
import { flattenMarks, toCodeUnits, type Mark } from "./marks.ts";

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  text: string;
}

/** Must resolve for every status, never throw on a 4xx or 5xx. */
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export interface TtsConfig {
  apiBase: string;
  apiKey: string;
  voiceId: string;
  model: string;
  http: Http;
}

export interface TtsResult {
  audio: Uint8Array;
  /** Characters Speechify bills for. */
  charsBilled: number;
  /** Word marks with character offsets into `input`. See marks.ts. */
  marks: Mark[];
}

/** Statuses worth retrying: the TTS API 429/503s in bursts during incidents. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1500, 4000];

export class TtsError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Speechify ${status}: ${body}`);
    this.name = "TtsError";
  }
}

interface SpeechResponse {
  audio_data?: unknown;
  billable_characters_count?: unknown;
  speech_marks?: unknown;
}

function isSpeechResponse(value: unknown): value is SpeechResponse {
  return typeof value === "object" && value !== null;
}

export async function synthesize(input: string, cfg: TtsConfig): Promise<TtsResult> {
  for (let attempt = 0; ; attempt++) {
    const res = await cfg.http({
      url: `${cfg.apiBase}/v1/audio/speech`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        voice_id: cfg.voiceId,
        model: cfg.model,
        audio_format: "mp3",
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (TRANSIENT.has(res.status) && delay !== undefined) {
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new TtsError(res.status, res.text.slice(0, 300));
    }

    const json = parseJson(res.text);
    if (!isSpeechResponse(json) || typeof json.audio_data !== "string") {
      throw new TtsError(0, "missing audio_data in response");
    }

    const audio = fromBase64(json.audio_data);
    return {
      audio,
      charsBilled:
        typeof json.billable_characters_count === "number"
          ? json.billable_characters_count
          : input.length,
      marks: toCodeUnits(flattenMarks(json.speech_marks), input),
    };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type Gender = "female" | "male" | "unspecified";

export interface Voice {
  id: string;
  name: string;
  locale: string;
  /** A workspace clone rather than a shared stock voice. */
  cloned: boolean;
  gender: Gender;
  /** Catalogue tags such as "narrator" or "young"; empty when none. */
  tags: string[];
  /** A sample the catalogue already has, or null when one must be synthesized. */
  preview: string | null;
  /** One of the roster voices the picker puts first. See `isFeatured`. */
  featured: boolean;
}

/**
 * The roster: the `*_32` voices on simba-3.2. The catalogue carries no flag
 * for them, but the suffix is how Speechify names the voices trained for
 * that model. Between 2026-09-08 and 2026-09-22 they were also the only
 * voices whose speech marks reached the last word; stock voices are fine
 * again since, clones still unchecked.
 * Other models have no roster here.
 */
export function isFeatured(id: string, model: string | undefined): boolean {
  return model === "simba-3.2" && /_32$/.test(id);
}

export interface RawVoice {
  id?: string;
  type?: string;
  display_name?: string;
  locale?: string;
  gender?: unknown;
  tags?: unknown;
  preview_audio?: unknown;
  models?: { name?: string; languages?: { locale?: string; preview_audio?: unknown }[] }[];
}

/**
 * One page of the voice catalog, normalized.
 *
 * `GET /v1/voices` answers in two shapes depending on the key, both seen
 * live on 2026-09-04: `{ voices, next_cursor, has_more }` cursor-paginated,
 * or a bare JSON array of the entire catalog with no cursor. Treat the shape
 * as something the server chooses, not something we know.
 */
export function normalizeVoicePage(json: unknown): { rows: RawVoice[]; cursor: string | null } {
  if (Array.isArray(json)) return { rows: json.filter(isRawVoice), cursor: null };
  if (typeof json !== "object" || json === null) return { rows: [], cursor: null };
  const body: { voices?: unknown; data?: unknown; next_cursor?: unknown; has_more?: unknown } = json;
  const rows = Array.isArray(body.voices) ? body.voices : Array.isArray(body.data) ? body.data : [];
  const cursor =
    body.has_more === true && typeof body.next_cursor === "string" ? body.next_cursor : null;
  return { rows: rows.filter(isRawVoice), cursor };
}

function isRawVoice(value: unknown): value is RawVoice {
  return typeof value === "object" && value !== null;
}

/** The catalogue's own sample for this voice: the voice's, else the model's for the voice's locale. */
function previewOf(raw: RawVoice, model: string | undefined): string | null {
  if (typeof raw.preview_audio === "string" && raw.preview_audio !== "") return raw.preview_audio;
  for (const m of raw.models ?? []) {
    if (model !== undefined && m.name !== model) continue;
    for (const lang of m.languages ?? []) {
      if (typeof lang.preview_audio === "string" && lang.preview_audio !== "") return lang.preview_audio;
    }
  }
  return null;
}

export function toVoice(raw: RawVoice, model?: string): Voice | null {
  if (!raw.id) return null;
  return {
    id: raw.id,
    name: raw.display_name ?? raw.id,
    locale: raw.locale ?? "",
    cloned: raw.type === "personal",
    gender: raw.gender === "female" || raw.gender === "male" ? raw.gender : "unspecified",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string" && t !== "") : [],
    preview: previewOf(raw, model),
    featured: raw.type !== "personal" && isFeatured(raw.id, model),
  };
}

/** Featured first, then shared narrators, then workspace clones; A to Z within each. */
export function sortVoices(voices: Voice[]): Voice[] {
  const rank = (v: Voice) => (v.featured ? 0 : v.cloned ? 2 : 1);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Catalogue tags arrive as "category:value"; the value is what people read. */
function tagLabel(tag: string): string {
  return tag.slice(tag.indexOf(":") + 1).replace(/-/g, " ").toLowerCase();
}

/**
 * The tag categories that say what a voice sounds like. A stock voice carries
 * about twenty tags (seen live 2026-10-01), most of them use cases and content
 * types; those can be searched but would bury the line if shown.
 */
const SHOWN_CATEGORIES = new Set(["age", "accent", "timbre", "style"]);

/** What a voice sounds like, in the catalogue's words: "young adult", "warm". */
export function voiceTraits(voice: Voice): string[] {
  return voice.tags
    .filter((tag) => SHOWN_CATEGORIES.has(tag.slice(0, tag.indexOf(":")).toLowerCase()))
    .map(tagLabel);
}

const LANGUAGE_NAMES = new Intl.DisplayNames("en", { type: "language" });

/** "en-GB" as "British English". A locale that has no name is shown as it came. */
export function languageName(locale: string): string {
  if (locale === "") return "";
  try {
    return LANGUAGE_NAMES.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** A voice in one line: where it is from and what it sounds like. */
export function describeVoice(voice: Voice): string {
  const parts = [
    voice.cloned ? "your clone" : "",
    voice.locale,
    voice.gender === "unspecified" ? "" : voice.gender,
    ...voiceTraits(voice),
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

/**
 * Does every search term start a word of the voice's name, id, description or
 * tags? Word starts, not substrings: "male" must not find every female voice.
 */
export function matchesVoice(voice: Voice, query: string): boolean {
  const searchable = [
    voice.name,
    voice.id,
    describeVoice(voice),
    languageName(voice.locale),
    ...voice.tags.map(tagLabel),
  ].join(" ");
  const words = searchable.toLowerCase().split(/[\s·_]+/);
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== "");
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

/** Voices on this key that can render `model`, walking every page. */
export async function listVoices(cfg: Omit<TtsConfig, "voiceId">): Promise<Voice[]> {
  const out: Voice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const query = `page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await cfg.http({
      url: `${cfg.apiBase}/v1/voices?${query}`,
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (res.status < 200 || res.status >= 300) throw new TtsError(res.status, res.text.slice(0, 200));

    const { rows, cursor: next } = normalizeVoicePage(parseJson(res.text));
    for (const raw of rows) {
      if (!(raw.models ?? []).some((m) => m.name === cfg.model)) continue;
      const voice = toVoice(raw, cfg.model);
      if (voice) out.push(voice);
    }
    cursor = next;
    if (!cursor) break;
  }
  return sortVoices(out);
}

export type KeyCheck =
  | { ok: true; voices: Voice[] }
  | { ok: false; reason: string };

/**
 * Is this a working Speechify key, and can it render our model?
 *
 * Run when a key is chosen in settings: an unchecked key would leave a
 * player that silently cannot speak, and the person would have no way to
 * tell whether they had mistyped or we were broken. Checking also tells us
 * which voices to offer.
 */
export async function checkKey(apiKey: string, apiBase: string, model: string, http: Http): Promise<KeyCheck> {
  const trimmed = apiKey.trim();
  if (trimmed === "") return { ok: false, reason: "Paste your Speechify API key." };
  if (trimmed.length < 20 || /\s/.test(trimmed)) {
    return { ok: false, reason: "That does not look like an API key." };
  }
  let voices: Voice[];
  try {
    voices = await listVoices({ apiBase, apiKey: trimmed, model, http });
  } catch (err) {
    if (err instanceof TtsError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "Speechify refused that key." };
    }
    return { ok: false, reason: "Could not reach Speechify to check that key. Try again." };
  }
  if (voices.length === 0) {
    return { ok: false, reason: `That key works, but no voice on it can render ${model}.` };
  }
  return { ok: true, voices };
}
