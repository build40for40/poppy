import type { JsonValue } from "./profile";
import { USER_MD } from "./profile";
import type { Reflection } from "./reflection";
import { linkKind, parseWikilinks, wikilink } from "./wikilinks";

export type NoteKind = "user" | "memory" | "session" | "interests" | "play";

type Frontmatter = { [key: string]: JsonValue };

interface FileRow extends Record<string, SqlStorageValue> {
  path: string;
  frontmatter: string;
  body: string;
}

export interface ReflectedSession {
  id: string;
  started_at: string;
  reflection: Reflection;
}

/** The heading in USER.md that the reflection writes under. The user's own text sits outside it and is never touched. */
export const LEARNED = "Learned in conversation";

export const INTERESTS_MD = "interests.md";
/** The heading in interests.md that the reflection writes under. */
export const INTERESTS = "What they're into";
const INTERESTS_START = "# Interests\n";

export const londonDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));
export const londonTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const londonDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

/** When the London day that `iso` falls in ends. It can be an hour out on the two days the clocks change, so callers compare dates as well. */
export function nextLondonMidnight(iso: string): string {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = (part("hour") * 3600 + part("minute") * 60 + part("second")) * 1000 + at.getMilliseconds();
  return new Date(at.getTime() + 24 * 3600 * 1000 - elapsed).toISOString();
}

export function sessionNotePath(session: Pick<ReflectedSession, "id" | "started_at">): string {
  return `sessions/${londonDate(session.started_at)}-${session.id.slice(0, 8)}.md`;
}

/** Rewrites the list under `## heading`, adding the section at the end when it's missing and dropping it when it ends up empty. */
export function editSection(body: string, heading: string, edit: (lines: string[]) => string[]): string {
  const lines = body.replace(/\s+$/, "").split("\n");
  const start = lines.indexOf(`## ${heading}`);
  const end = start === -1 ? lines.length : nextHeading(lines, start + 1);
  const current = start === -1 ? [] : lines.slice(start + 1, end).filter((l) => l.trim());
  const next = edit(current);
  const before = (start === -1 ? lines : lines.slice(0, start)).join("\n").replace(/\s+$/, "");
  const after = lines.slice(end).join("\n").replace(/\s+$/, "");
  const section = next.length ? `## ${heading}\n\n${next.join("\n")}` : "";
  return `${[before, section, after].filter(Boolean).join("\n\n")}\n`;
}

/** Swaps one session's lines for new ones, leaving every other session's lines alone. */
export const replaceSessionLines = (key: string, lines: string[]) => (current: string[]) => [...current.filter((l) => !l.includes(key)), ...lines];

/** Adds the lines that aren't there yet. */
export const addLines = (lines: string[]) => (current: string[]) => [...new Set([...current, ...lines])];

/**
 * Writes everything one reflection learned into the vault, then rebuilds the links. Running it again with the same input changes nothing:
 * every line a session adds carries that session's [[wikilink]], and a rerun replaces that session's lines.
 */
export function writeReflection(sql: SqlStorage, session: ReflectedSession, now: string): string {
  const { reflection } = session;
  const sessionPath = sessionNotePath(session);
  const sessionLink = wikilink(sessionPath);

  writeFile(sql, sessionPath, "session", { session_id: session.id, date: londonDate(session.started_at) }, sessionBody(session), now);

  const user = readFile(sql, USER_MD);
  if (user) {
    writeFile(sql, USER_MD, "user", user.frontmatter, editSection(user.body, LEARNED, sessionEntries(sessionLink, reflection.preferences)), now);
  }

  const interests = readFile(sql, INTERESTS_MD);
  if (interests || reflection.interests.length) {
    const body = editSection(interests?.body ?? INTERESTS_START, INTERESTS, sessionEntries(sessionLink, reflection.interests));
    writeFile(sql, INTERESTS_MD, "interests", interests?.frontmatter ?? {}, body, now);
  }

  rebuildLinks(sql);
  return sessionPath;
}

/** Throws away the links table and reads it back from every note's [[wikilinks]], so it can never drift from the notes. */
export function rebuildLinks(sql: SqlStorage): void {
  sql.exec("DELETE FROM links");
  for (const { path, body } of sql.exec<FileRow>("SELECT path, body FROM files ORDER BY path").toArray()) {
    for (const dst of parseWikilinks(body)) {
      if (dst !== path) sql.exec("INSERT OR IGNORE INTO links (src, dst, kind) VALUES (?, ?, ?)", path, dst, linkKind(dst));
    }
  }
}

/** Swaps one session's entries for new ones, skipping any that another session already left. */
function sessionEntries(sessionLink: string, entries: string[]) {
  return (current: string[]) => {
    const others = current.filter((l) => !l.includes(sessionLink));
    const known = new Set(others.map(preferenceText));
    return [...others, ...entries.filter((e) => !known.has(e.toLowerCase())).map((e) => `- ${e} (${sessionLink})`)];
  };
}

function sessionBody({ started_at, reflection }: ReflectedSession): string {
  const list = (heading: string, items: string[]) => (items.length ? `## ${heading}\n\n${items.map((i) => `- ${i}`).join("\n")}` : "");
  return [`# Conversation, ${londonDay(started_at)}`, reflection.summary, list("Learned about them", reflection.preferences), list(INTERESTS, reflection.interests)].filter(Boolean).join("\n\n").concat("\n");
}

function entryText(line: string): string {
  return line.replace(/^- /, "").replace(/ \(\[\[[^\]]*\]\]\)$/, "");
}

function preferenceText(line: string): string {
  return entryText(line).toLowerCase();
}

const hasLearned = (body: string) => body.split("\n").includes(`## ${LEARNED}`);
const withoutLearned = (body: string) => (hasLearned(body) ? editSection(body, LEARNED, () => []) : body);

/** Splits USER.md's body into the user's free text and the entries the assistant learned, without bullets or session links. */
export function splitLearned(body: string): { about: string; learned: string[] } {
  return { about: withoutLearned(body), learned: sectionLines(body, LEARNED).map(entryText) };
}

/** Replaces the free text of USER.md's body, keeping the learned section as it is. For when users can edit their own profile. */
export function replaceAbout(body: string, about: string): string {
  const learned = sectionLines(body, LEARNED);
  const free = withoutLearned(about);
  return learned.length ? editSection(free, LEARNED, () => learned) : free;
}

export function sectionLines(body: string, heading: string): string[] {
  let found: string[] = [];
  editSection(body, heading, (lines) => (found = lines));
  return found;
}

function nextHeading(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (/^#{1,2} /.test(lines[i])) return i;
  return lines.length;
}

export function readFile(sql: SqlStorage, path: string): { frontmatter: Frontmatter; body: string } | null {
  const row = sql.exec<FileRow>("SELECT path, frontmatter, body FROM files WHERE path = ?", path).toArray()[0];
  return row ? { frontmatter: JSON.parse(row.frontmatter), body: row.body } : null;
}

/** Saves a note, leaving it and its updated_at untouched when nothing changed. */
export function writeFile(sql: SqlStorage, path: string, kind: NoteKind, frontmatter: Frontmatter, body: string, now: string): void {
  sql.exec(
    `INSERT INTO files (path, kind, frontmatter, body, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET kind = excluded.kind, frontmatter = excluded.frontmatter, body = excluded.body, updated_at = excluded.updated_at
     WHERE files.kind IS NOT excluded.kind OR files.frontmatter IS NOT excluded.frontmatter OR files.body IS NOT excluded.body`,
    path,
    kind,
    JSON.stringify(frontmatter),
    body,
    now,
  );
}
