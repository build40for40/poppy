import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { UserBrain } from "./brain";
import { applyPlayEvents, nudgeDue, NUDGE_AFTER_MINUTES, openPlay, parseCheckIn, parseStart, type PlayStart } from "./plays";

const sockSorting: PlayStart = { message: "Try fake sock sorting.", activity: "Fake sock sorting", setup: "Tip out the socks.", location: "home", props: ["socks"], minutes: 45, picture: "", pictureBrief: "" };

function inVault<T>(name: string, run: (sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(env.USER_BRAIN.get(env.USER_BRAIN.idFromName(name)), (brain: UserBrain, state) => {
    brain.getProfile();
    return run(state.storage.sql);
  });
}

const statuses = (sql: SqlStorage) =>
  sql
    .exec<{ frontmatter: string }>("SELECT frontmatter FROM files WHERE kind = 'play' ORDER BY json_extract(frontmatter, '$.started_at')")
    .toArray()
    .map((r) => JSON.parse(r.frontmatter))
    .map((f) => [f.activity, f.status]);

describe("parseStart", () => {
  it("tidies a suggestion and keeps the time within bounds", () => {
    expect(parseStart({ ...sockSorting, activity: "  Fake   sock sorting ", props: ["socks", "socks", " "], minutes: 500 })).toEqual({ ...sockSorting, minutes: 180 });
    expect(parseStart({ ...sockSorting, minutes: "ages" })).toMatchObject({ minutes: 60 });
  });

  it("says what's wrong with a suggestion that's missing something", () => {
    expect(parseStart(null)).toEqual(expect.stringContaining("start_play needs"));
    expect(parseStart({ ...sockSorting, location: " " })).toEqual(expect.stringContaining("none of them empty"));
  });
});

describe("parseCheckIn", () => {
  it("takes a check-in with or without a length", () => {
    expect(parseCheckIn({ went: "fine", minutes: null, feedback: " Did the job. " })).toEqual({ went: "fine", minutes: null, feedback: "Did the job." });
    expect(parseCheckIn({ went: "flop", minutes: 4.6, feedback: "Wandered off." })).toMatchObject({ minutes: 5 });
  });

  it("says what's wrong with one it can't file", () => {
    expect(parseCheckIn({ went: "amazing", minutes: 5, feedback: "Yes." })).toEqual(expect.stringContaining("loved, fine, flop"));
    expect(parseCheckIn({ went: "loved", minutes: 5, feedback: "" })).toEqual(expect.stringContaining("never empty"));
  });
});

describe("applyPlayEvents", () => {
  it("opens a play session and works out when to ask how it went", async () => {
    await inVault("plays_open", (sql) => {
      applyPlayEvents(sql, [{ type: "start", play: sockSorting }], "chat-1", "2026-11-10T14:00:00.000Z");
      const open = openPlay(sql)!;
      expect(open).toMatchObject({ activity: "Fake sock sorting", sessionId: "chat-1", minutes: 45, nudgedAt: null });
      expect(open.path).toMatch(/^plays\/2026-11-10-[0-9a-f]{8}\.md$/);
      expect(nudgeDue(open)).toBe(Date.parse("2026-11-10T14:00:00.000Z") + (45 + NUDGE_AFTER_MINUTES) * 60_000);
      expect(nudgeDue(open, 1)).toBe(Date.parse("2026-11-10T14:46:00.000Z"));
    });
  });

  it("closes a play session left open by an earlier chat when a new one starts", async () => {
    await inVault("plays_unanswered", (sql) => {
      applyPlayEvents(sql, [{ type: "start", play: sockSorting }], "chat-1", "2026-11-10T14:00:00.000Z");
      applyPlayEvents(sql, [{ type: "start", play: { ...sockSorting, activity: "Fake cushion mountain" } }], "chat-2", "2026-11-11T09:00:00.000Z");
      expect(statuses(sql)).toEqual([
        ["Fake sock sorting", "no_check_in"],
        ["Fake cushion mountain", "open"],
      ]);
    });
  });

  it("takes a check-in and the next suggestion in one turn", async () => {
    await inVault("plays_both", (sql) => {
      applyPlayEvents(sql, [{ type: "start", play: sockSorting }], "chat-1", "2026-11-10T14:00:00.000Z");
      applyPlayEvents(
        sql,
        [
          { type: "check_in", checkIn: { went: "flop", minutes: 5, feedback: "Wandered off." } },
          { type: "start", play: { ...sockSorting, activity: "Fake cushion mountain" } },
        ],
        "chat-1",
        "2026-11-10T14:10:00.000Z",
      );
      expect(statuses(sql)).toEqual([
        ["Fake sock sorting", "done"],
        ["Fake cushion mountain", "open"],
      ]);
    });
  });
});
