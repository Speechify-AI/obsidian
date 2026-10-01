import { describe, expect, it } from "vitest";
import {
  clipPassages,
  passageIndexAt,
  sourceRange,
  spokenOffsetAt,
  toPassages,
  type Passage,
} from "./speakable.ts";

const spoken = (source: string, limit?: number): string[] => toPassages(source, limit).map((p) => p.text);

/** Every spoken character must be the note's character at its mapped offset. */
function expectFaithful(source: string, passages: Passage[]): void {
  for (const passage of passages) {
    expect(passage.map).toHaveLength(passage.text.length);
    for (let i = 0; i < passage.text.length; i++) {
      const original = source[passage.map[i]!]!;
      const ch = passage.text[i]!;
      if (ch === " ") expect(/\s/.test(original)).toBe(true);
      else expect(original).toBe(ch);
      if (i > 0) expect(passage.map[i]!).toBeGreaterThan(passage.map[i - 1]!);
    }
  }
}

describe("toPassages: blocks", () => {
  it("reads paragraphs, joining wrapped lines with a space", () => {
    expect(spoken("One line\nstill one.\n\nTwo.")).toEqual(["One line still one.", "Two."]);
  });

  it("reads a heading as its own passage, without the hashes", () => {
    expect(spoken("# Title\nBody text.\n## Closed ##\nMore.")).toEqual(["Title", "Body text.", "Closed", "More."]);
  });

  it("reads each list item as its own passage, with wrapped lines", () => {
    const source = "- First\n- Second\n  continues\n1. Third\n- [ ] A task\n- [x] Done task";
    expect(spoken(source)).toEqual(["First", "Second continues", "Third", "A task", "Done task"]);
  });

  it("skips frontmatter only when it is closed", () => {
    expect(spoken("---\ntitle: x\ntags: [a]\n---\nBody.")).toEqual(["Body."]);
    expect(spoken("---\nBody.")).toEqual(["Body."]);
  });

  it("skips fenced code, including an unterminated fence", () => {
    expect(spoken("Before.\n```js\nconst x = 1;\n```\nAfter.")).toEqual(["Before.", "After."]);
    expect(spoken("Before.\n~~~\ncode\n```\nstill code\n~~~\nAfter.")).toEqual(["Before.", "After."]);
    expect(spoken("Before.\n```\nnever closed")).toEqual(["Before."]);
  });

  it("skips tables, with or without outer pipes", () => {
    expect(spoken("A.\n\n| h | i |\n| - | - |\n| 1 | 2 |\n\nB.")).toEqual(["A.", "B."]);
    expect(spoken("A.\n\nName | Value\n--- | ---\nAlpha | Beta\nGamma | Delta\n\nB.")).toEqual(["A.", "B."]);
    expect(spoken("A.\n\n| only |\n| --- |\n| cell |\nB.")).toEqual(["A.", "B."]);
    expect(spoken("> | h | i |\n> | - | - |\n> | 1 | 2 |\n> After.")).toEqual(["After."]);
    // A pipe in prose is not a table.
    expect(spoken("Either this | or that.")).toEqual(["Either this | or that."]);
  });

  it("skips indented code, but not an indented line inside a list or a paragraph", () => {
    expect(spoken("Before.\n\n    const secret = 42;\n    more();\n\nAfter.")).toEqual(["Before.", "After."]);
    expect(spoken("Before.\n\n\tconst tabbed = 1;\n\nAfter.")).toEqual(["Before.", "After."]);
    expect(spoken("- Item\n\n    Its second paragraph.\n\nAfter.\n\n    code();")).toEqual([
      "Item",
      "Its second paragraph.",
      "After.",
    ]);
    expect(spoken("A paragraph\n    with a hanging indent.")).toEqual(["A paragraph with a hanging indent."]);
    expect(spoken("- Outer\n    - Nested item")).toEqual(["Outer", "Nested item"]);
  });

  it("skips rules, math blocks and comments", () => {
    expect(spoken("A.\n\n---\n\nB.\n***\nC.")).toEqual(["A.", "B.", "C."]);
    expect(spoken("A.\n$$\nx^2\n$$\nB.")).toEqual(["A.", "B."]);
    expect(spoken("A %%hidden%% word.\n%%\nwhole block\n%%\nB. <!-- note -->")).toEqual(["A word.", "B."]);
  });

  it("reads quotes and callouts", () => {
    expect(spoken("> Quoted line\n> continues.")).toEqual(["Quoted line continues."]);
    expect(spoken("> [!tip] Remember this\n> The body.")).toEqual(["Remember this", "The body."]);
    expect(spoken("> [!warning]-\n> The body.")).toEqual(["warning", "The body."]);
  });

  it("reads a footnote's text and drops link definitions and block ids", () => {
    expect(spoken("Claim.[^1] ^abc123\n\n[^1]: The source.\n[ref]: https://example.com")).toEqual([
      "Claim.",
      "The source.",
    ]);
  });

  it("returns nothing for an empty or unreadable note", () => {
    expect(spoken("")).toEqual([]);
    expect(spoken("\n\n```\ncode\n```\n")).toEqual([]);
  });
});

describe("toPassages: inline markup", () => {
  it("drops emphasis markers and keeps the words", () => {
    expect(spoken("Some **bold**, *italic*, ***both***, ~~struck~~ and ==marked== text.")).toEqual([
      "Some bold, italic, both, struck and marked text.",
    ]);
    expect(spoken("An _underscored_ word and __strong__ one.")).toEqual(["An underscored word and strong one."]);
  });

  it("keeps symbols that are not markup", () => {
    expect(spoken("2 * 3 and a == b and snake_case and ~5.")).toEqual(["2 * 3 and a == b and snake_case and ~5."]);
  });

  it("reads link text, never the target", () => {
    expect(spoken("See [the **docs**](https://example.com/a_b) and [this][ref].")).toEqual(["See the docs and this."]);
  });

  it("reads what a wikilink shows", () => {
    expect(spoken("[[Note]], [[Note|an alias]], [[Note#Heading]], [[#Heading]].")).toEqual([
      "Note, an alias, Note, Heading.",
    ]);
  });

  it("drops images, embeds, URLs, HTML tags and footnote markers", () => {
    expect(spoken("A ![alt](x.png) b ![[embed.png]] c.")).toEqual(["A b c."]);
    expect(spoken("Go to https://example.com/x. Or <https://example.com>.")).toEqual(["Go to . Or ."]);
    expect(spoken('A <span class="x">styled</span> word<br>here.')).toEqual(["A styled wordhere."]);
  });

  it("keeps inline code and drops inline math", () => {
    expect(spoken("Call `render()` when $x^2$ costs $5 and $10.")).toEqual(["Call render() when costs $5 and $10."]);
  });

  it("reads a tag as its name and an escaped character as itself", () => {
    expect(spoken("Filed under #project and C# with \\*stars\\* and #123.")).toEqual([
      "Filed under project and C# with *stars* and #123.",
    ]);
  });
});

describe("the source map", () => {
  const source = [
    "---",
    "title: x",
    "---",
    "# A *Title*",
    "",
    "First **bold** line with [a link](https://x.y)",
    "and [[Target|an alias]] wrapped.",
    "",
    "- item `code` %%gone%% here ^id1",
  ].join("\n");

  it("maps every spoken character to the same character in the note", () => {
    const passages = toPassages(source);
    expect(passages.map((p) => p.text)).toEqual([
      "A Title",
      "First bold line with a link and an alias wrapped.",
      "item code here",
    ]);
    expectFaithful(source, passages);
  });

  it("turns a spoken range into the note range behind it", () => {
    const paragraph = toPassages(source)[1]!;
    const at = (word: string) => {
      const start = paragraph.text.indexOf(word);
      const range = sourceRange(paragraph, start, start + word.length)!;
      return source.slice(range.from, range.to);
    };
    expect(at("bold")).toBe("bold");
    expect(at("a link")).toBe("a link");
    expect(at("an alias")).toBe("an alias");
    // A range that crosses markup takes the markup with it.
    expect(at("First bold line")).toBe("First **bold** line");
    expect(sourceRange(paragraph, 3, 3)).toBeNull();
  });

  it("finds the passage and spoken offset for a cursor position", () => {
    const passages = toPassages(source);
    const cursor = source.indexOf("wrapped");
    const index = passageIndexAt(passages, cursor);
    expect(index).toBe(1);
    const offset = spokenOffsetAt(passages[index]!, cursor);
    expect(passages[index]!.text.slice(offset)).toBe("wrapped.");
    // A cursor inside skipped text lands on what is read next.
    expect(passageIndexAt(passages, 2)).toBe(0);
    expect(passageIndexAt(passages, source.length)).toBe(-1);
  });

  it("clips to a selection", () => {
    const from = source.indexOf("bold");
    const to = source.indexOf("wrapped");
    const clipped = clipPassages(toPassages(source), from, to);
    expect(clipped.map((p) => p.text)).toEqual(["bold line with a link and an alias"]);
    expectFaithful(source, clipped);
  });
});

describe("long paragraphs", () => {
  it("cuts at sentence ends, each piece trimmed and still mapped", () => {
    const source = `${"A sentence of **some** length here. ".repeat(12)}The end.`;
    const passages = toPassages(source, 120);
    expect(passages.length).toBeGreaterThan(3);
    for (const p of passages) {
      expect(p.text.length).toBeLessThanOrEqual(120);
      expect(p.text).toBe(p.text.trim());
      expect(/[.]$/.test(p.text)).toBe(true);
    }
    expectFaithful(source, passages);
    expect(passages.map((p) => p.text).join(" ")).toBe(source.replace(/\*\*/g, ""));
  });
});
