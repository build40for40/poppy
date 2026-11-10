import { describe, expect, it } from "vitest";
import { assembleContext, LIVE_PROMPT } from "./prompt";

describe("LIVE_PROMPT", () => {
  it("lays out the three kinds of message parents get", () => {
    for (const heading of ["## 1. A suggestion, before play", "## 2. A review, after play", "## 3. A look back, at what the child has done"]) {
      expect(LIVE_PROMPT).toContain(heading);
    }
  });

  it("only ever asks for WhatsApp's single-asterisk bold", () => {
    expect(LIVE_PROMPT).not.toMatch(/\*\*[^*\n]+\*\*/);
  });
});

describe("assembleContext", () => {
  const base = { user: { preferences: { language: "en" }, about: "# About me\n\nFake person.\n" }, interests: null, memory: null, plays: [], openPlay: null, sessionNotes: [], pictures: [], time: "14:05", today: "10 November 2026" };

  it("lays out the profile, interests, memory, the play log, earlier conversations and the time", () => {
    const context = assembleContext(base);
    expect(context).toBe(
      [
        '# USER.md\n\nPreferences: {"language":"en"}\n\n# About me\n\nFake person.',
        "# interests.md\n\nNothing yet.",
        "# MEMORY.md\n\nNothing yet.",
        "# Play log, newest first\n\nNo play sessions yet.",
        "# Waiting for a check-in\n\nNothing.",
        "# Your last conversations, newest first\n\nNone yet: this is the first time you've talked.",
        "# This conversation\n\nIt started at 14:05 on 10 November 2026, UK time.",
        "# Pictures\n\nNone yet.",
      ].join("\n\n"),
    );
  });

  it("includes earlier session notes and cuts long ones short", () => {
    const context = assembleContext({
      ...base,
      memory: "Lesson one.",
      sessionNotes: [
        { path: "sessions/2026-11-09-bbbbbbbb.md", frontmatter: '{"date":"2026-11-09"}', body: "# Conversation\n\nSecond.\n" },
        { path: "sessions/2026-11-08-aaaaaaaa.md", frontmatter: "{}", body: "x".repeat(7_000) },
      ],
    });
    expect(context).toContain("# MEMORY.md\n\nLesson one.");
    expect(context).toContain('## sessions/2026-11-09-bbbbbbbb.md\nfrontmatter: {"date":"2026-11-09"}\n# Conversation\n\nSecond.');
    expect(context).toContain(`${"x".repeat(6_000)}\n[cut short]`);
    expect(context).not.toContain("x".repeat(6_001));
  });

  it("shows the play log and names the play session waiting for a check-in", () => {
    const context = assembleContext({
      ...base,
      interests: "# Interests\n\n## What they're into\n\n- Loves fake diggers\n",
      plays: [{ path: "plays/2026-11-10-cccccccc.md", frontmatter: '{"activity":"Fake sock sorting","status":"open"}', body: "# Fake sock sorting\n\nTip out the socks.\n" }],
      openPlay: "plays/2026-11-10-cccccccc.md",
    });
    expect(context).toContain("# interests.md\n\n# Interests\n\n## What they're into\n\n- Loves fake diggers");
    expect(context).toContain('## plays/2026-11-10-cccccccc.md\nfrontmatter: {"activity":"Fake sock sorting","status":"open"}\n# Fake sock sorting\n\nTip out the socks.');
    expect(context).toContain("# Waiting for a check-in\n\nplays/2026-11-10-cccccccc.md is still open");
  });

  it("lists the pictures Claude can put on a suggestion, last", () => {
    const context = assembleContext({ ...base, pictures: [{ id: "toy-bath", about: "Toys having a bath" }, { id: "fake-swamp", about: "A fake swamp" }] });
    expect(context.endsWith("# Pictures\n\n- toy-bath: Toys having a bath\n- fake-swamp: A fake swamp")).toBe(true);
  });

  it("gives the same bytes for the same input, so the prompt cache holds", () => {
    expect(assembleContext(base)).toBe(assembleContext(structuredClone(base)));
  });
});
