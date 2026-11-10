import { isPlainObject } from "./http";
import { editSection, londonDate, readFile, writeFile } from "./vault";

export const DEFAULT_PLAY_MINUTES = 60;
export const MAX_PLAY_MINUTES = 180;
/** How long after an activity was meant to end Poppy asks how it went, if nobody has said. */
export const NUDGE_AFTER_MINUTES = 60;
export const MAX_PLAY_NOTES = 10;
export const HOW_IT_WENT = "How it went";

const MAX_NAME = 80;
const MAX_TEXT = 1_500;
const MAX_PROPS = 12;
const MAX_BRIEF = 300;
const WENT = ["loved", "fine", "flop"] as const;

export type Went = (typeof WENT)[number];

export interface PlayStart {
  activity: string;
  setup: string;
  location: string;
  props: string[];
  minutes: number;
  /** The picture Claude chose to go on top of the suggestion, or empty for none. */
  picture: string;
  /** What a new picture should show, when none fitted. Never saved to the play note: it's for the picture shelf. */
  pictureBrief: string;
}

export interface PlayCheckIn {
  went: Went;
  /** How long it held the child, when the parent said. */
  minutes: number | null;
  feedback: string;
}

/** What a live turn did to the play log. Applied to the vault only once the turn is saved. */
export type PlayEvent = { type: "start"; play: PlayStart } | { type: "check_in"; checkIn: PlayCheckIn };

/** The one play session still waiting for the parent to say how it went. */
export interface OpenPlay {
  path: string;
  activity: string;
  sessionId: string;
  startedAt: string;
  minutes: number;
  nudgedAt: string | null;
}

interface PlayRow extends Record<string, SqlStorageValue> {
  path: string;
  frontmatter: string;
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/[ \t]+/g, " ").slice(0, max) : "");
const oneLine = (value: unknown, max: number) => clean(value, max).replace(/\s+/g, " ");

/** Checks a `start_play` call. Returns what to save, or what was wrong with it for Claude to fix. */
export function parseStart(input: unknown): PlayStart | string {
  if (!isPlainObject(input)) return "start_play needs {activity, setup, location, props, minutes}.";
  const activity = oneLine(input.activity, MAX_NAME);
  const setup = clean(input.setup, MAX_TEXT);
  const location = oneLine(input.location, MAX_NAME);
  if (!activity || !setup || !location) return "start_play needs activity, setup and location, none of them empty.";
  const props = Array.isArray(input.props) ? [...new Set(input.props.map((p) => oneLine(p, MAX_NAME)).filter(Boolean))].slice(0, MAX_PROPS) : [];
  const minutes = typeof input.minutes === "number" && Number.isFinite(input.minutes) ? Math.min(Math.max(Math.round(input.minutes), 5), MAX_PLAY_MINUTES) : DEFAULT_PLAY_MINUTES;
  const picture = oneLine(input.picture, MAX_NAME).toLowerCase();
  const pictureBrief = picture ? "" : oneLine(input.picture_brief, MAX_BRIEF);
  return { activity, setup, location, props, minutes, picture, pictureBrief };
}

/** Checks a `check_in` call. Returns what to save, or what was wrong with it for Claude to fix. */
export function parseCheckIn(input: unknown): PlayCheckIn | string {
  if (!isPlainObject(input) || !WENT.includes(input.went as Went)) return `check_in needs {went, minutes, feedback}, with went one of ${WENT.join(", ")}.`;
  const feedback = oneLine(input.feedback, MAX_TEXT);
  if (!feedback) return "check_in needs feedback: what the parent said about how it went, never empty.";
  const minutes = typeof input.minutes === "number" && Number.isFinite(input.minutes) && input.minutes >= 0 ? Math.min(Math.round(input.minutes), 24 * 60) : null;
  return { went: input.went as Went, minutes, feedback };
}

export function openPlay(sql: SqlStorage): OpenPlay | null {
  const row = sql
    .exec<PlayRow>("SELECT path, frontmatter FROM files WHERE kind = 'play' AND json_extract(frontmatter, '$.status') = 'open' ORDER BY json_extract(frontmatter, '$.started_at') DESC LIMIT 1")
    .toArray()[0];
  if (!row) return null;
  const f = JSON.parse(row.frontmatter);
  return { path: row.path, activity: f.activity, sessionId: f.session_id, startedAt: f.started_at, minutes: f.planned_minutes, nudgedAt: f.nudged_at ?? null };
}

/** When to ask how it went: after the time the activity was meant to fill, plus a while for the parent to say so unprompted. */
export function nudgeDue(play: OpenPlay, afterMinutes = NUDGE_AFTER_MINUTES): number {
  return Date.parse(play.startedAt) + (play.minutes + afterMinutes) * 60_000;
}

export function markNudged(sql: SqlStorage, path: string, now: string): void {
  update(sql, path, { nudged_at: now }, now);
}

/**
 * Writes one turn's play events into the vault, in order. Only one play session is open at a time: starting another in the
 * same chat means the last suggestion was turned down, so it's dropped; one left open by an earlier chat is closed unanswered.
 */
export function applyPlayEvents(sql: SqlStorage, events: PlayEvent[], sessionId: string, now: string): void {
  for (const event of events) {
    const open = openPlay(sql);
    if (event.type === "check_in") {
      if (!open) continue;
      const { went, minutes, feedback } = event.checkIn;
      update(sql, open.path, { status: "done", went, ...(minutes === null ? {} : { minutes }), ended_at: now }, now, (body) => editSection(body, HOW_IT_WENT, () => [feedback]));
      continue;
    }
    if (open?.sessionId === sessionId) sql.exec("DELETE FROM files WHERE path = ?", open.path);
    else if (open) update(sql, open.path, { status: "no_check_in", ended_at: now }, now);
    const { activity, setup, location, props, minutes, picture } = event.play;
    const id = crypto.randomUUID();
    const frontmatter = { play_id: id, session_id: sessionId, activity, location, props, planned_minutes: minutes, ...(picture ? { picture } : {}), started_at: now, status: "open" };
    writeFile(sql, `plays/${londonDate(now)}-${id.slice(0, 8)}.md`, "play", frontmatter, `# ${activity}\n\n${setup}\n`, now);
  }
}

function update(sql: SqlStorage, path: string, fields: Record<string, string | number>, now: string, editBody: (body: string) => string = (body) => body): void {
  const note = readFile(sql, path);
  if (note) writeFile(sql, path, "play", { ...note.frontmatter, ...fields }, editBody(note.body), now);
}
