/**
 * The spoken sentence and word, painted in Reading view.
 *
 * Reading view is rendered HTML. Obsidian says which lines of the note each
 * rendered section came from, so a note range is found in two steps: the
 * section holding it, then its words among the words on screen (align.ts).
 *
 * It is painted with the CSS Custom Highlight API, which colours ranges of
 * text without changing the DOM. That DOM is Obsidian's and other plugins',
 * and Obsidian rebuilds it as you scroll, so nothing is wrapped or inserted.
 */
import type { MarkdownPostProcessorContext, MarkdownView } from "obsidian";
import { alignSpoken, sectionSpoken, shownSpan } from "./align.ts";
import type { Highlight as Spoken } from "./highlight.ts";
import { BAR_CLEARANCE_PX } from "./player.ts";
import { toPassages, type Passage, type SourceRange } from "./speakable.ts";

/** The names styles.css paints, as `::highlight(name)`. */
const SENTENCE = "speechify-sentence";
const WORD = "speechify-word";

/** Text on screen that is never read: other notes embedded here, footnote numbers, math, buttons. */
const NOT_READ = ".internal-embed, .footnote-ref, .math, .copy-code-button, .collapse-indicator";
/** Elements whose text does not run on from their neighbour's. */
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, div";

export interface ReadingPainter {
  /** The markdown post processor: remembers how to ask where each rendered section came from. */
  process(el: HTMLElement, context: MarkdownPostProcessorContext): void;
  /** Paint ranges of the note as it stands now. `moved` says the sentence changed. */
  paint(view: MarkdownView, highlight: Spoken, moved: boolean): void;
  clear(): void;
}

interface Section {
  el: HTMLElement;
  /** The note as Reading view rendered it, and this section's range in it. */
  text: string;
  from: number;
  to: number;
}

/** A section's text as shown, and where each text node begins in it. */
interface Shown {
  text: string;
  nodes: Text[];
  starts: number[];
}

export function createReadingPainter(follow: () => boolean): ReadingPainter {
  const contexts = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
  /** The last note read into passages; Reading view hands back the same text every time. */
  let read: { text: string; passages: Passage[]; lineStarts: number[] } | null = null;
  /** The registry our highlights are in, one per window, so they can be removed from it. */
  let painted: HighlightRegistry | null = null;
  let scroller: HTMLElement | null = null;
  /** False once the person scrolls away, until the spoken sentence is back on screen. */
  let following = true;
  /** A view rendered before the plugin loaded is rendered again, once per listen. */
  let rerendered = false;
  const onScroll = (): void => {
    following = false;
  };

  function reading(text: string): NonNullable<typeof read> {
    if (read?.text !== text) {
      const lineStarts = [0];
      for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lineStarts.push(at + 1);
      read = { text, passages: toPassages(text), lineStarts };
    }
    return read;
  }

  /** The rendered section holding note offset `position`, if it is in the DOM. */
  function sectionAt(sections: HTMLElement[], position: number): Section | null {
    for (const el of sections) {
      const info = contexts.get(el)?.getSectionInfo(el);
      if (!info) continue;
      const { lineStarts } = reading(info.text);
      const from = lineStarts[info.lineStart] ?? info.text.length;
      const to = lineStarts[info.lineEnd + 1] ?? info.text.length;
      if (position >= from && position < to) return { el, text: info.text, from, to };
    }
    return null;
  }

  function watch(next: HTMLElement | null): void {
    if (next === scroller) return;
    scroller?.removeEventListener("wheel", onScroll);
    scroller?.removeEventListener("touchmove", onScroll);
    scroller = next;
    scroller?.addEventListener("wheel", onScroll, { passive: true });
    scroller?.addEventListener("touchmove", onScroll, { passive: true });
  }

  function unpaint(): void {
    painted?.delete(SENTENCE);
    painted?.delete(WORD);
    painted = null;
  }

  return {
    process(el, context) {
      contexts.set(el, context);
    },

    paint(view, highlight, moved) {
      const container = view.previewMode.containerEl;
      const win = container.ownerDocument.defaultView;
      if (!win || !("highlights" in win.CSS)) return;
      const registry = win.CSS.highlights;
      if (painted !== registry) unpaint();
      watch(container.querySelector<HTMLElement>(".markdown-preview-view"));

      const anchor = highlight.sentence ?? highlight.word;
      // This note's own sections: an embedded note has a sizer and sections of its own further in.
      const sizer = container.querySelector(".markdown-preview-sizer");
      const sections = Array.from(sizer?.querySelectorAll<HTMLElement>(":scope > div") ?? []);
      const section = anchor && sectionAt(sections, anchor.from);
      if (!anchor || !section) {
        unpaint();
        if (!anchor) return;
        if (!rerendered && sections.length > 0 && !sections.some((el) => contexts.has(el))) {
          rerendered = true;
          view.previewMode.rerender(true);
        } else if (moved && following && follow()) {
          // The section is far enough off screen that Obsidian has not rendered it.
          view.previewMode.applyScroll(view.editor.offsetToPos(anchor.from).line);
        }
        return;
      }

      const spoken = sectionSpoken(reading(section.text).passages, section.from, section.to);
      const shown = shownText(section.el);
      const at = alignSpoken(spoken.text, shown.text);
      const rangeOf = (range: SourceRange | null): Range | null => {
        const span = range && shownSpan(spoken, at, range);
        return span && domRange(shown, span);
      };
      const sentence = rangeOf(highlight.sentence);
      const word = rangeOf(highlight.word);

      painted = registry;
      if (sentence) registry.set(SENTENCE, new win.Highlight(sentence));
      else registry.delete(SENTENCE);
      if (word) {
        const above = new win.Highlight(word);
        above.priority = 1;
        registry.set(WORD, above);
      } else registry.delete(WORD);

      if (!moved || !sentence || !scroller || !follow()) return;
      const line = sentence.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const onScreen = line.top >= box.top && line.bottom <= box.bottom - BAR_CLEARANCE_PX;
      if (onScreen) following = true;
      else if (following) sentence.startContainer.parentElement?.scrollIntoView({ block: "center" });
    },

    clear() {
      unpaint();
      watch(null);
      following = true;
      rerendered = false;
    },
  };
}

/** The text of a rendered section, node by node, with a line break where one block ends and the next begins. */
function shownText(section: HTMLElement): Shown {
  const shown: Shown = { text: "", nodes: [], starts: [] };
  const walker = section.ownerDocument.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(NOT_READ)) continue;
    const block = parent.closest(BLOCK);
    if (block !== lastBlock && shown.text !== "") shown.text += "\n";
    lastBlock = block;
    shown.nodes.push(node as Text);
    shown.starts.push(shown.text.length);
    shown.text += node.nodeValue ?? "";
  }
  return shown;
}

/** A DOM range over `shown.text[span.from, span.to)`. Both ends are characters that were found, so both lie in a node. */
function domRange(shown: Shown, span: SourceRange): Range | null {
  const start = nodeAt(shown, span.from);
  const end = nodeAt(shown, span.to - 1);
  if (!start || !end) return null;
  const range = start.node.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function nodeAt(shown: Shown, index: number): { node: Text; offset: number } | null {
  for (let i = shown.nodes.length - 1; i >= 0; i--) {
    const node = shown.nodes[i];
    const start = shown.starts[i];
    if (!node || start === undefined || start > index) continue;
    const offset = index - start;
    return offset < node.length ? { node, offset } : null;
  }
  return null;
}
