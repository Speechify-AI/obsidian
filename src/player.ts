/**
 * Playback: one note, read passage by passage through one audio element,
 * with the spoken sentence and word painted in the editor.
 *
 * The note is read into passages once, when playback starts. Each passage is
 * rendered when the playhead needs it, plus a short look-ahead, so a note
 * stopped after a sentence costs a sentence. People edit while they listen:
 * within a passage the highlight follows the edit (see highlight.ts), and at
 * each passage boundary the note is read again if it changed, so what is
 * read next is what the note says now.
 *
 * A render that is under way is never abandoned. Closing the connection does
 * not cancel a /v1/audio/speech request and it is billed either way, so it
 * runs to the end and lands in the cache.
 */
import { EditorView } from "@codemirror/view";
import {
  hasEdits,
  showHighlight,
  startTracking,
  stopTracking,
  toCurrent,
  toCurrentPosition,
  type Highlight,
} from "./highlight.ts";
import { markAtTime, timeSentences, type TimedRange } from "./marks.ts";
import { renderKey, renderPassage, type RenderCache, type Rendered } from "./render.ts";
import { sentenceAtOffset, sentenceAtTime, skipTarget } from "./seek.ts";
import {
  clipPassages,
  passageIndexAt,
  sourceRange,
  spokenOffsetAt,
  toPassages,
  type Passage,
  type SourceRange,
} from "./speakable.ts";
import { TtsError, type TtsConfig } from "./speechify.ts";

export type Status = "idle" | "loading" | "playing" | "paused";

export interface PlayerState {
  status: Status;
  rate: number;
}

export interface PlayerHost {
  /** What to render with, or null when there is no API key yet. */
  config(): TtsConfig | null;
  cache: RenderCache;
  /** Keep the spoken sentence on screen? */
  follow(): boolean;
  onState(state: PlayerState): void;
  onError(message: string): void;
  /**
   * What is painted in the editor, as ranges of the note as it stands now, or
   * null when nothing is. `moved` says the sentence changed. Reading view is
   * painted from this.
   */
  onPaint(highlight: Highlight | null, moved: boolean): void;
}

export interface StartOptions {
  /** Start at the sentence holding this note offset rather than at the top. */
  from?: number;
  /** Read only this range of the note. */
  selection?: SourceRange;
}

export interface Player {
  /** Read the note in `view`. False when there was nothing to read or no key. */
  start(view: EditorView, options?: StartOptions): boolean;
  /** Play or pause. False when nothing is loaded, so the caller can start. */
  toggle(): boolean;
  skip(direction: 1 | -1): void;
  setRate(rate: number): void;
  /** The voice changed: say the current sentence again in the new one. */
  voiceChanged(): void;
  stop(): void;
  /** The editor being read, if any. */
  view(): EditorView | null;
}

/** Passages rendered ahead of the one playing. */
const LOOK_AHEAD = 2;
/** A cached passage loads in a few milliseconds; only a real wait shows as loading. */
const LOADING_AFTER_MS = 150;
/** The player bar floats over the bottom of the note. */
export const BAR_CLEARANCE_PX = 96;

interface Session {
  view: EditorView;
  passages: Passage[];
  index: number;
  selection: SourceRange | null;
  /** The passage that is loaded into the audio element, once it is. */
  current: { rendered: Rendered; sentences: TimedRange[] } | null;
  /** What is painted now, so a frame with nothing new paints nothing. */
  painted: { word: number; sentence: number };
  /** False once the person scrolls away, until the spoken sentence is back on screen. */
  following: boolean;
  onScroll: () => void;
}

export function createPlayer(host: PlayerHost): Player {
  const audio = new Audio();
  audio.preload = "auto";
  let session: Session | null = null;
  let status: Status = "idle";
  let rate = 1;
  /** Bumped by anything that supersedes a load in flight. */
  let turn = 0;
  let frame = 0;
  let objectUrl: string | null = null;
  const inFlight = new Map<string, Promise<Rendered>>();
  /** Set when we pause or play the element ourselves, so its event is not taken for a media key. */
  let ownPause = false;
  let ownPlay = false;

  const pauseAudio = (): void => {
    if (audio.paused) return;
    ownPause = true;
    audio.pause();
  };

  const setStatus = (next: Status): void => {
    status = next;
    host.onState({ status, rate });
  };

  async function render(text: string): Promise<Rendered> {
    const config = host.config();
    if (!config) throw new Error("no key");
    const key = await renderKey(text, config.voiceId, config.model);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = renderPassage(text, config, host.cache).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  function prefetch(s: Session): void {
    for (let ahead = 1; ahead <= LOOK_AHEAD; ahead++) {
      const passage = s.passages[s.index + ahead];
      // A failure here surfaces when the passage is actually played.
      if (passage) render(passage.text).catch(() => undefined);
    }
  }

  function load(bytes: Uint8Array): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
    audio.src = objectUrl;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
  }

  async function playAt(index: number, offset = 0): Promise<void> {
    const s = session;
    const passage = s?.passages[index];
    if (!s || !passage) return stop();
    const mine = ++turn;
    s.index = index;
    s.current = null;
    s.painted = { word: -1, sentence: -1 };
    pauseAudio();
    // The whole passage is marked while its audio is on the way.
    paint(s, { sentence: sourceRange(passage, 0, passage.text.length), word: null }, true);
    const waiting = window.setTimeout(() => {
      if (mine === turn) setStatus("loading");
    }, LOADING_AFTER_MS);
    // Asked for now, alongside this passage, not once it has arrived: a short
    // heading is over before a passage requested at its start would be ready.
    prefetch(s);

    let rendered: Rendered;
    try {
      rendered = await render(passage.text);
    } catch (error) {
      if (mine !== turn) return;
      setStatus("paused");
      host.onError(explain(error));
      return;
    } finally {
      window.clearTimeout(waiting);
    }
    if (mine !== turn) return;

    const sentences = timeSentences(passage.text, rendered.marks);
    s.current = { rendered, sentences };
    load(rendered.audio);
    if (offset > 0) audio.currentTime = (sentences[sentenceAtOffset(sentences, offset)]?.startMs ?? 0) / 1000;
    await resume();
  }

  async function resume(): Promise<void> {
    const mine = turn;
    ownPlay = audio.paused;
    try {
      await audio.play();
    } catch {
      ownPlay = false;
      // Refused (mobile wants a tap first) or cut short by a newer load.
      if (mine === turn) setStatus("paused");
      return;
    }
    if (mine !== turn) return;
    setStatus("playing");
    window.cancelAnimationFrame(frame);
    const step = (): void => {
      if (status !== "playing") return;
      paintAt(audio.currentTime * 1000);
      frame = window.requestAnimationFrame(step);
    };
    step();
  }

  function paintAt(ms: number): void {
    const s = session;
    const passage = s?.passages[s.index];
    if (!s || !s.current || !passage) return;
    const mark = markAtTime(s.current.rendered.marks, ms);
    const word = mark ? mark.start : -1;
    const sentenceIndex = sentenceAtTime(s.current.sentences, ms);
    if (word === s.painted.word && sentenceIndex === s.painted.sentence) return;
    const moved = sentenceIndex !== s.painted.sentence;
    s.painted = { word, sentence: sentenceIndex };
    const sentence = s.current.sentences[sentenceIndex];
    paint(
      s,
      {
        sentence: sentence ? trimmedRange(passage, sentence.start, sentence.end) : null,
        word: mark ? trimmedRange(passage, mark.start, mark.end) : null,
      },
      moved,
    );
  }

  function paint(s: Session, highlight: Highlight, moved: boolean): void {
    if (!s.view.dom.isConnected) return;
    showHighlight(s.view, highlight);
    const sentence = toCurrent(s.view, highlight.sentence);
    host.onPaint({ sentence, word: toCurrent(s.view, highlight.word) }, moved);
    if (moved) keepInView(s, sentence);
  }

  function keepInView(s: Session, sentence: SourceRange | null): void {
    // offsetParent is null while the editor is hidden: Reading view, or a background tab.
    if (!sentence || !host.follow() || s.view.dom.offsetParent === null) return;
    const line = s.view.coordsAtPos(sentence.from);
    const box = s.view.scrollDOM.getBoundingClientRect();
    const onScreen = line !== null && line.top >= box.top && line.bottom <= box.bottom - BAR_CLEARANCE_PX;
    if (onScreen) s.following = true;
    else if (s.following) s.view.dispatch({ effects: EditorView.scrollIntoView(sentence.from, { y: "center" }) });
  }

  /** Go to the passage after or before the one that is loaded. */
  function move(direction: 1 | -1): void {
    const s = session;
    if (!s) return;
    if (s.view.dom.isConnected && hasEdits(s.view)) return moveInEditedNote(s, direction);
    const index = Math.max(0, s.index + direction);
    void playAt(index, direction === -1 && s.index > 0 ? lastOffset(s.passages[index]) : 0);
  }

  /**
   * The same move when the note has changed since it was read. Passage
   * indexes mean nothing any more: the paragraph being read may have been
   * deleted, or cut into different passages. So the note is read again and
   * the place is found by position: forward resumes at the first text after
   * where this passage ended, back at the last text before where it began.
   */
  function moveInEditedNote(s: Session, direction: 1 | -1): void {
    const map = s.passages[s.index]?.map ?? [];
    const boundary =
      direction === 1
        ? toCurrentPosition(s.view, (map[map.length - 1] ?? 0) + 1, -1)
        : toCurrentPosition(s.view, map[0] ?? 0, 1);
    s.selection = toCurrent(s.view, s.selection);
    s.passages = read(s.view, s.selection);
    startTracking(s.view);

    const at = passageIndexAt(s.passages, boundary);
    const next = at === -1 ? s.passages.length : at;
    if (direction === 1) {
      const passage = s.passages[next];
      return void playAt(next, passage ? spokenOffsetAt(passage, boundary) : 0);
    }
    // The passage at the boundary may begin before it: then that is the one to go back into.
    const straddles = (s.passages[next]?.map[0] ?? boundary) < boundary;
    const index = Math.max(0, straddles ? next : next - 1);
    void playAt(index, lastOffset(s.passages[index]));
  }

  audio.addEventListener("ended", () => move(1));
  // Paused or resumed from outside: a media key, the OS, a headset button.
  audio.addEventListener("pause", () => {
    if (ownPause) ownPause = false;
    else if (status === "playing" && !audio.ended) setStatus("paused");
  });
  audio.addEventListener("play", () => {
    if (ownPlay) ownPlay = false;
    else if (status === "paused" && session?.current) void resume();
  });

  function stop(): void {
    turn++;
    window.cancelAnimationFrame(frame);
    pauseAudio();
    audio.removeAttribute("src");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    if (session) {
      session.view.scrollDOM.removeEventListener("wheel", session.onScroll);
      session.view.scrollDOM.removeEventListener("touchmove", session.onScroll);
      if (session.view.dom.isConnected) stopTracking(session.view);
      host.onPaint(null, false);
    }
    session = null;
    setStatus("idle");
  }

  return {
    start(view, options = {}) {
      stop();
      if (!host.config()) {
        host.onError("Add your Speechify API key in the plugin's settings to start listening.");
        return false;
      }
      const passages = read(view, options.selection ?? null);
      let index = 0;
      let offset = 0;
      if (options.from !== undefined) {
        index = passageIndexAt(passages, options.from);
        const passage = passages[index];
        if (passage) offset = spokenOffsetAt(passage, options.from);
      }
      if (passages.length === 0 || index === -1) {
        host.onError(options.selection ? "Nothing to read in the selection." : "Nothing to read here.");
        return false;
      }
      const s: Session = {
        view,
        passages,
        index,
        selection: options.selection ?? null,
        current: null,
        painted: { word: -1, sentence: -1 },
        following: true,
        onScroll: () => {
          s.following = false;
        },
      };
      session = s;
      view.scrollDOM.addEventListener("wheel", s.onScroll, { passive: true });
      view.scrollDOM.addEventListener("touchmove", s.onScroll, { passive: true });
      startTracking(view);
      void playAt(index, offset);
      return true;
    },

    toggle() {
      const s = session;
      if (!s) return false;
      s.following = true;
      if (status === "playing" || status === "loading") {
        // No passage loaded means one is on its way: it must not start when it lands.
        if (!s.current) turn++;
        pauseAudio();
        setStatus("paused");
      } else if (s.current) {
        void resume();
      } else {
        void playAt(s.index);
      }
      return true;
    },

    skip(direction) {
      const s = session;
      if (!s?.current) return;
      s.following = true;
      const target = skipTarget(s.current.sentences, audio.currentTime * 1000, direction);
      if (target === "next") return move(1);
      if (target === "previous") return move(-1);
      const startMs = s.current.sentences[target]?.startMs ?? 0;
      audio.currentTime = startMs / 1000;
      paintAt(startMs);
    },

    setRate(next) {
      rate = next;
      audio.defaultPlaybackRate = next;
      audio.playbackRate = next;
      host.onState({ status, rate });
    },

    voiceChanged() {
      const s = session;
      if (!s) return;
      const sentence = s.current?.sentences[sentenceAtTime(s.current.sentences, audio.currentTime * 1000)];
      void playAt(s.index, sentence?.start ?? 0);
    },

    stop,
    view: () => session?.view ?? null,
  };
}

/** A spoken offset inside a passage's last sentence: where going back lands. */
function lastOffset(passage: Passage | undefined): number {
  return Math.max(0, (passage?.text.length ?? 1) - 1);
}

function read(view: EditorView, selection: SourceRange | null): Passage[] {
  const passages = toPassages(view.state.doc.toString());
  return selection ? clipPassages(passages, selection.from, selection.to) : passages;
}

/**
 * The note range for a spoken range, without the whitespace at its edges.
 * Sentences begin at the space after the last one, and a mark that absorbed
 * a gap can begin at a space too; neither should be painted.
 */
function trimmedRange(passage: Passage, start: number, end: number): SourceRange | null {
  const slice = passage.text.slice(start, end);
  const lead = slice.length - slice.trimStart().length;
  return sourceRange(passage, start + lead, start + slice.trimEnd().length);
}

function explain(error: unknown): string {
  if (!(error instanceof TtsError)) return "Could not reach Speechify. Check your connection and press play to try again.";
  if (error.status === 401 || error.status === 403) return "Speechify refused the API key. Check it in the plugin's settings.";
  if (error.status === 402) return "This Speechify API key is out of credit.";
  if (error.status === 429) return "Speechify is rate limiting this key. Press play to try again in a moment.";
  return `Speechify could not render this passage (${error.status}). Press play to try again.`;
}
