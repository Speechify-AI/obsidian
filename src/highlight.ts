/**
 * The spoken sentence and word, painted in the editor.
 *
 * Two mark decorations over note ranges, so they work in Live Preview and
 * Source mode alike and markup inside a range is simply covered.
 *
 * The player reads the note once, when it starts, and every range it knows
 * is an offset into that reading. People edit while they listen, so this
 * field also composes every change made since the reading (`edits`), and a
 * range is mapped through it before it is painted. Typing above the playhead
 * moves the highlight with the text instead of leaving it behind.
 */
import { StateEffect, StateField, type ChangeDesc, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SourceRange } from "./speakable.ts";

export interface Highlight {
  sentence: SourceRange | null;
  word: SourceRange | null;
}

const paint = StateEffect.define<Highlight | null>();
/** true: the player has just read the note, count edits from here. false: stop counting. */
const track = StateEffect.define<boolean>();

interface FieldValue {
  decorations: DecorationSet;
  tracking: boolean;
  edits: ChangeDesc | null;
}

const sentenceMark = Decoration.mark({ class: "speechify-sentence" });
const wordMark = Decoration.mark({ class: "speechify-word" });

const field = StateField.define<FieldValue>({
  create: () => ({ decorations: Decoration.none, tracking: false, edits: null }),
  update(value, transaction) {
    let { decorations, tracking, edits } = value;
    if (transaction.docChanged) {
      decorations = decorations.map(transaction.changes);
      if (tracking) edits = edits ? edits.composeDesc(transaction.changes.desc) : transaction.changes.desc;
    }
    for (const effect of transaction.effects) {
      if (effect.is(track)) {
        tracking = effect.value;
        edits = null;
      } else if (effect.is(paint)) {
        decorations = toDecorations(effect.value, transaction.state.doc.length);
      }
    }
    return { decorations, tracking, edits };
  },
  provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
});

function toDecorations(highlight: Highlight | null, length: number): DecorationSet {
  if (!highlight) return Decoration.none;
  const inside = (range: SourceRange | null): range is SourceRange =>
    range !== null && range.from < range.to && range.to <= length;
  const ranges = [];
  if (inside(highlight.sentence)) ranges.push(sentenceMark.range(highlight.sentence.from, highlight.sentence.to));
  if (inside(highlight.word)) ranges.push(wordMark.range(highlight.word.from, highlight.word.to));
  return Decoration.set(ranges, true);
}

export const highlightExtension: Extension = field;

/** Has this editor loaded the extension? One that has not cannot be painted. */
export function canHighlight(view: EditorView): boolean {
  return view.state.field(field, false) !== undefined;
}

/** A range from the player's reading of the note, as it stands in the note now. */
export function toCurrent(view: EditorView, range: SourceRange | null): SourceRange | null {
  if (!range) return null;
  const edits = view.state.field(field, false)?.edits;
  if (!edits) return range;
  return { from: edits.mapPos(range.from, 1), to: edits.mapPos(range.to, -1) };
}

/** One position from the player's reading, now. `side` says which way it leans when text was inserted there. */
export function toCurrentPosition(view: EditorView, position: number, side: -1 | 1): number {
  return view.state.field(field, false)?.edits?.mapPos(position, side) ?? position;
}

export function hasEdits(view: EditorView): boolean {
  const edits = view.state.field(field, false)?.edits;
  return edits !== null && edits !== undefined && !edits.empty;
}

/** The player has just read the note: ranges from now on are offsets into this state. */
export function startTracking(view: EditorView): void {
  view.dispatch({ effects: track.of(true) });
}

export function stopTracking(view: EditorView): void {
  view.dispatch({ effects: [track.of(false), paint.of(null)] });
}

/** Paint ranges given in the player's reading of the note; null clears. */
export function showHighlight(view: EditorView, highlight: Highlight | null): void {
  const current = highlight && { sentence: toCurrent(view, highlight.sentence), word: toCurrent(view, highlight.word) };
  view.dispatch({ effects: paint.of(current) });
}
