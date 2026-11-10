import { describe, expect, it } from "vitest";
import { assembleContext } from "./prompt";

describe("assembleContext", () => {
  const base = { user: { preferences: { language: "en" }, about: "# About me\n\nFake person.\n" }, memory: null, sessionNotes: [], today: "10 November 2026" };

  it("lays out the profile, memory, earlier conversations and the day", () => {
    const context = assembleContext(base);
    expect(context).toBe(
      [
        '# USER.md\n\nPreferences: {"language":"en"}\n\n# About me\n\nFake person.',
        "# MEMORY.md\n\nNothing yet.",
        "# Your last conversations, newest first\n\nNone yet: this is the first time you've talked.",
        "# This conversation\n\nIt started on 10 November 2026, UK time.",
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

  it("gives the same bytes for the same input, so the prompt cache holds", () => {
    expect(assembleContext(base)).toBe(assembleContext(structuredClone(base)));
  });
});
