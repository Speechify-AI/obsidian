import { describe, expect, it } from "vitest";
import { alignSpoken, sectionSpoken, shownSpan } from "./align.ts";
import { toPassages } from "./speakable.ts";

/** What Reading view shows for the part of `note` that reads `phrase`, given the section's text on screen. */
function shownFor(note: string, shown: string, phrase: string): string | null {
  const spoken = sectionSpoken(toPassages(note), 0, note.length);
  const start = spoken.text.indexOf(phrase);
  const from = spoken.source[start] ?? -1;
  const to = (spoken.source[start + phrase.length - 1] ?? -1) + 1;
  const span = shownSpan(spoken, alignSpoken(spoken.text, shown), { from, to });
  return span && shown.slice(span.from, span.to);
}

describe("alignSpoken", () => {
  it("finds each word where the screen has it, markup gone", () => {
    const note = "Mara climbed the **spiral stairs** every *evening*.";
    const shown = "Mara climbed the spiral stairs every evening.";
    expect(shownFor(note, shown, "spiral")).toBe("spiral");
    expect(shownFor(note, shown, "spiral stairs every")).toBe("spiral stairs every");
    expect(shownFor(note, shown, "evening.")).toBe("evening.");
  });

  it("tells a repeated word apart by its place", () => {
    const note = "The lamp and the log and the tide.";
    const shown = "The lamp and the log and the tide.";
    const spoken = sectionSpoken(toPassages(note), 0, note.length);
    const at = alignSpoken(spoken.text, shown);
    expect(shownSpan(spoken, at, { from: 13, to: 16 })).toEqual({ from: 13, to: 16 });
    expect(shownSpan(spoken, at, { from: 25, to: 28 })).toEqual({ from: 25, to: 28 });
  });

  it("steps over what the screen shows and the voice skips", () => {
    const note = "See https://example.com/a for a map, #storms and [[Tides#Spring]].";
    const shown = "See https://example.com/a for a map, #storms and Tides > Spring.";
    expect(shownFor(note, shown, "for")).toBe("for");
    // Not the "a" of "example" or the one that ends the address.
    const spoken = sectionSpoken(toPassages(note), 0, note.length);
    const at = alignSpoken(spoken.text, shown);
    expect(shownSpan(spoken, at, { from: 30, to: 31 })).toEqual({ from: 30, to: 31 });
    expect(shownFor(note, shown, "storms")).toBe("storms");
    expect(shownFor(note, shown, "Tides")).toBe("Tides");
    // The full stop is not the next thing after "Tides" on screen, so it is left out.
    expect(shownFor(note, shown, "Tides.")).toBe("Tides");
  });

  it("finds punctuation and words that hug it", () => {
    const note = "It's a café-quiet place (a Thursday), she said.";
    expect(shownFor(note, note, "café-quiet")).toBe("café-quiet");
    expect(shownFor(note, note, "(a Thursday),")).toBe("(a Thursday),");
    expect(shownFor(note, note, "It's")).toBe("It's");
  });

  it("leaves a word the screen does not have unpainted and carries on", () => {
    const note = "Fish &amp; chips tonight.";
    const shown = "Fish & chips tonight.";
    expect(shownFor(note, shown, "amp")).toBeNull();
    expect(shownFor(note, shown, "&amp;")).toBe("&");
    expect(shownFor(note, shown, "chips")).toBe("chips");
    expect(shownFor(note, shown, "Fish &amp; chips")).toBe("Fish & chips");
  });

  it("does not jump to a far repeat of a missing word", () => {
    const filler = "word ".repeat(120);
    const note = `Alpha &amp; beta. ${filler}Then &amp; again.`;
    const shown = `Alpha & beta. ${filler}Then &amp; again.`;
    expect(shownFor(note, shown, "beta.")).toBe("beta.");
  });

  it("ignores case, as a callout titled by its type is shown capitalised", () => {
    const note = "> [!note]\n> The worst storm came in March.";
    const shown = "Note\nThe worst storm came in March.";
    expect(shownFor(note, shown, "note")).toBe("Note");
    expect(shownFor(note, shown, "storm")).toBe("storm");
  });
});

describe("sectionSpoken", () => {
  it("takes only the passages that begin inside the section", () => {
    const note = "First paragraph.\n\nSecond paragraph, the one wanted.\n\nThird.";
    const from = note.indexOf("Second");
    const spoken = sectionSpoken(toPassages(note), from, note.indexOf("Third"));
    expect(spoken.text).toBe("Second paragraph, the one wanted.");
    expect(spoken.source[0]).toBe(from);
  });

  it("joins a list's items with a space that belongs to no place in the note", () => {
    const note = "- One\n- Two";
    const spoken = sectionSpoken(toPassages(note), 0, note.length);
    expect(spoken.text).toBe("One Two");
    expect(spoken.source).toEqual([2, 3, 4, -1, 8, 9, 10]);
  });
});
