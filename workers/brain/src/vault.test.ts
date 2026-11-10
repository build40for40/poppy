import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { UserBrain } from "./brain";
import type { Reflection } from "./reflection";
import { addLines, editSection, londonDate, londonDay, nextLondonMidnight, rebuildLinks, replaceAbout, replaceSessionLines, sessionNotePath, splitLearned, writeReflection, type ReflectedSession } from "./vault";

const reflection: Reflection = { summary: "Asked about fake things.", preferences: ["Prefers short answers"] };

const session = (overrides: Partial<ReflectedSession> = {}): ReflectedSession => ({
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  started_at: "2026-11-10T18:00:00Z",
  reflection,
  ...overrides,
});

function inVault<T>(name: string, run: (sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(env.USER_BRAIN.get(env.USER_BRAIN.idFromName(name)), (brain: UserBrain, state) => {
    brain.getProfile();
    return run(state.storage.sql);
  });
}

const files = (sql: SqlStorage) => sql.exec<{ path: string; kind: string; frontmatter: string; body: string; updated_at: string }>("SELECT * FROM files ORDER BY path").toArray();
const links = (sql: SqlStorage) => sql.exec<{ src: string; dst: string; kind: string }>("SELECT * FROM links ORDER BY src, dst").toArray();
const body = (sql: SqlStorage, path: string) => sql.exec<{ body: string }>("SELECT body FROM files WHERE path = ?", path).one().body;

describe("editSection", () => {
  it("adds a missing section at the end and drops one that ends up empty", () => {
    expect(editSection("# Note\n\nText.", "Seen", () => ["- one"])).toBe("# Note\n\nText.\n\n## Seen\n\n- one\n");
    expect(editSection("# Note\n\n## Seen\n\n- one\n\n## Other\n\n- two\n", "Seen", () => [])).toBe("# Note\n\n## Other\n\n- two\n");
  });

  it("rewrites only the lines under its own heading", () => {
    const before = "# Note\n\n## Seen\n\n- one\n\n## Other\n\n- two\n";
    expect(editSection(before, "Seen", (lines) => [...lines, "- three"])).toBe("# Note\n\n## Seen\n\n- one\n- three\n\n## Other\n\n- two\n");
  });

  it("swaps one session's lines and only adds lines that are new", () => {
    expect(replaceSessionLines("[[sessions/a]]", ["- new ([[sessions/a]])"])(["- old ([[sessions/a]])", "- kept ([[sessions/b]])"])).toEqual(["- kept ([[sessions/b]])", "- new ([[sessions/a]])"]);
    expect(addLines(["- one", "- two"])(["- one"])).toEqual(["- one", "- two"]);
  });
});

describe("splitLearned and replaceAbout", () => {
  const learnedBody = "# About me\n\nFake person.\n\n## Learned in conversation\n\n- Prefers short answers ([[sessions/s1]])\n- Works nights ([[sessions/s2]])\n\n## Other\n\n- a thing\n";

  it("splits the free text from the learned entries", () => {
    expect(splitLearned(learnedBody)).toEqual({ about: "# About me\n\nFake person.\n\n## Other\n\n- a thing\n", learned: ["Prefers short answers", "Works nights"] });
  });

  it("leaves a body with no learned section alone", () => {
    expect(splitLearned("# About me")).toEqual({ about: "# About me", learned: [] });
    expect(replaceAbout("# About me", "New text")).toBe("New text");
  });

  it("keeps the learned section when about is replaced", () => {
    expect(replaceAbout(learnedBody, "# About me\n\nStill fake.")).toBe("# About me\n\nStill fake.\n\n## Learned in conversation\n\n- Prefers short answers ([[sessions/s1]])\n- Works nights ([[sessions/s2]])\n");
  });
});

describe("London time", () => {
  it("uses the London day, either side of midnight and of the clocks changing", () => {
    expect(londonDate("2026-11-10T23:59:59Z")).toBe("2026-11-10");
    expect(londonDate("2026-07-10T23:30:00Z")).toBe("2026-07-11");
    expect(londonDay("2026-11-10T18:00:00Z")).toBe("10 November 2026");
  });

  it("finds the end of the London day", () => {
    expect(nextLondonMidnight("2026-11-10T18:00:00Z")).toBe("2026-11-11T00:00:00.000Z");
    expect(nextLondonMidnight("2026-07-10T18:00:00Z")).toBe("2026-07-10T23:00:00.000Z");
    expect(nextLondonMidnight("2026-11-10T00:00:00Z")).toBe("2026-11-11T00:00:00.000Z");
  });

  it("names a session note by London day and the start of the session id", () => {
    expect(sessionNotePath(session())).toBe("sessions/2026-11-10-aaaaaaaa.md");
  });
});

describe("writeReflection", () => {
  it("writes the session note, adds what was learned to USER.md and links them", async () => {
    await inVault("vault_write", (sql) => {
      expect(writeReflection(sql, session(), "2026-11-10T19:00:00Z")).toBe("sessions/2026-11-10-aaaaaaaa.md");
      expect(files(sql).map((f) => [f.path, f.kind])).toEqual([
        ["USER.md", "user"],
        ["sessions/2026-11-10-aaaaaaaa.md", "session"],
      ]);
      expect(body(sql, "sessions/2026-11-10-aaaaaaaa.md")).toBe("# Conversation, 10 November 2026\n\nAsked about fake things.\n\n## Learned about them\n\n- Prefers short answers\n");
      expect(body(sql, "USER.md")).toContain("## Learned in conversation\n\n- Prefers short answers ([[sessions/2026-11-10-aaaaaaaa]])\n");
      expect(links(sql)).toEqual([{ src: "USER.md", dst: "sessions/2026-11-10-aaaaaaaa.md", kind: "session" }]);
    });
  });

  it("changes nothing when it runs again with the same input", async () => {
    await inVault("vault_again", (sql) => {
      writeReflection(sql, session(), "2026-11-10T19:00:00Z");
      const before = files(sql);
      writeReflection(sql, session(), "2026-11-10T20:00:00Z");
      expect(files(sql)).toEqual(before);
    });
  });

  it("replaces a session's own lines on a rerun and keeps other sessions' lines", async () => {
    await inVault("vault_rerun", (sql) => {
      writeReflection(sql, session(), "2026-11-10T19:00:00Z");
      writeReflection(sql, session({ id: "bbbbbbbb-2222-4222-8222-222222222222", reflection: { summary: "Second chat.", preferences: ["Works nights", "prefers SHORT answers"] } }), "2026-11-10T19:30:00Z");
      writeReflection(sql, session({ reflection: { summary: "Asked about fake things.", preferences: ["Likes lists"] } }), "2026-11-10T20:00:00Z");
      expect(splitLearned(body(sql, "USER.md")).learned).toEqual(["Works nights", "Likes lists"]);
    });
  });

  it("keeps the user's own text in USER.md", async () => {
    await inVault("vault_about", (sql) => {
      const before = splitLearned(body(sql, "USER.md")).about;
      writeReflection(sql, session(), "2026-11-10T19:00:00Z");
      expect(splitLearned(body(sql, "USER.md")).about).toBe(before);
    });
  });
});

describe("rebuildLinks", () => {
  it("rebuilds links from the notes, so a removed link disappears", async () => {
    await inVault("vault_links", (sql) => {
      writeReflection(sql, session(), "2026-11-10T19:00:00Z");
      sql.exec("UPDATE files SET body = '# About me\n' WHERE path = 'USER.md'");
      rebuildLinks(sql);
      expect(links(sql)).toEqual([]);
    });
  });
});
