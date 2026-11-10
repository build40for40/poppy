import { DurableObject } from "cloudflare:workers";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, liveModel } from "./claude";
import { USER_MD, type Preferences, type Profile, type PublicProfile } from "./profile";
import { applyPlayEvents, markNudged, MAX_PLAY_NOTES, NUDGE_AFTER_MINUTES, nudgeDue, openPlay } from "./plays";
import { assembleContext, MAX_SESSION_NOTES, MEMORY_MD, type Note } from "./prompt";
import { isRetryable, reflect, type Reflection } from "./reflection";
import { migrate } from "./schema";
import { starterAbout, starterPreferences } from "./seed";
import { appendUserText, runTurn } from "./turn";
import type { Turn } from "./types";
import { sendTwilioText, TWILIO_SEND_GAP_MS } from "./twilio";
import { INTERESTS_MD, londonDate, londonDay, londonTime, nextLondonMidnight, readFile, splitLearned, writeFile, writeReflection } from "./vault";
import { markReadAndTyping, sendText, WhatsAppError, type Address, type Incoming, type Provider } from "./whatsapp";

/** A chat has no "end" button, so a session ends when the person has been quiet this long. A play session outlives it: see plays.ts. */
export const IDLE_MINUTES = 30;
/** A session also ends after this many user turns, because what it learns only reaches the context of the next one. */
export const TURN_CAP = 40;
/** Sent on its own, this wipes everything the brain holds about the sender. */
export const FORGET_COMMAND = "/forget";

/** How long to wait before trying a failed reflection again, by attempt. After the last one it's saved as failed. */
export const REFLECTION_RETRY_MINUTES = [1, 5, 30, 120];
const REFLECTION_TIMEOUT_MS = 10 * 60_000;
/** Meta redelivers a webhook for up to seven days, so handled message ids are kept a little longer to spot repeats. */
const INBOX_KEEP_MS = 8 * 24 * 3600 * 1000;

/** Minutes from an optional env var: a positive number, or the fallback. */
function minutesFrom(value: string | undefined, fallback: number): number {
  const minutes = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallback;
}

export const REPLIES = {
  forgotten: "Done. I've deleted everything I knew about you and your little one. WhatsApp keeps its own copy of this chat, so clear it there too if you want it gone.",
  textOnly: "I can only read text for now. Could you type it out?",
  turnFailed: "Sorry, I lost the thread there. Could you send that again?",
  unavailable: "Sorry, I can't reply right now. Try again in a bit.",
  nudge: (activity: string) => `How did "${activity}" go? Tell me how long it lasted and what they made of it, and I'll remember for next time.`,
};

/** How replies get back to a person: the provider their messages arrive through. */
interface Channel {
  send(to: Address, text: string): Promise<void>;
  /** Marks a message read and shows typing, where the provider can. */
  markRead(messageId: string): Promise<void>;
}

export type EndReason = "idle" | "turn_cap" | "midnight";
export type ReflectionStatus = "not_ended" | "pending" | "done" | "failed";

/** The reflection as saved on the session, with the path of the session note it wrote. */
export type SavedReflection = Reflection & { note: string };

interface SessionRow extends Record<string, SqlStorageValue> {
  id: string;
  model: string;
  context: string;
  messages: string;
  turns: string;
  facts: string;
  user_turns: number;
  started_at: string;
  last_message_at: string;
  ended_at: string | null;
  end_reason: string | null;
  reflect_after: string | null;
  reflection_attempts: number;
  reflected_at: string | null;
  reflection: string | null;
  reflection_error: string | null;
}

interface InboxRow extends Record<string, SqlStorageValue> {
  seq: number;
  message_id: string;
  kind: string;
  text: string;
  received_at: string;
}

interface NoteRow extends Record<string, SqlStorageValue> {
  path: string;
  frontmatter: string;
  body: string;
}

export interface DevState {
  chat_open: boolean;
  play_waiting: string | null;
  next_alarm: string | null;
}

export interface DevMemory {
  notes: { path: string; frontmatter: unknown; body: string }[];
  state: DevState;
}

/** What running the alarm did. `ended` is the chat that was open beforehand, if it ended. */
export interface DevOutcome {
  changed: string[];
  ended: { reason: EndReason; reflection: ReflectionStatus; error: string | null } | null;
  state: DevState;
}

export interface SessionView {
  id: string;
  started_at: string;
  ended_at: string | null;
  end_reason: EndReason | null;
  user_turns: number;
  turns: Turn[];
  facts: string[];
  reflection: SavedReflection | null;
  reflection_status: ReflectionStatus;
}

/**
 * Everything the assistant knows about one person, and the only thing that talks to them.
 *
 * Messages arrive through `receive`, which stores them and sets the alarm for now. The alarm does all the work, one run at a
 * time: it answers what's in the inbox, ends sessions that have gone quiet, files what ended sessions taught it, then sets
 * itself for the next deadline. Anything that arrives while it's busy waits in the inbox and is answered together as the next turn.
 */
export class UserBrain extends DurableObject<Env> {
  private ready = false;

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private get idleMs(): number {
    return minutesFrom(this.env.IDLE_MINUTES, IDLE_MINUTES) * 60_000;
  }

  private get nudgeAfterMinutes(): number {
    return minutesFrom(this.env.NUDGE_AFTER_MINUTES, NUDGE_AFTER_MINUTES);
  }

  private init(): void {
    if (this.ready) return;
    this.ctx.storage.transactionSync(() => {
      const now = new Date().toISOString();
      if (migrate(this.sql, now) === 0) writeFile(this.sql, USER_MD, "user", starterPreferences, starterAbout, now);
    });
    this.ready = true;
  }

  /** Stores one incoming message and wakes the alarm. A message id seen before is dropped, since Meta redelivers webhooks. */
  async receive(message: Incoming): Promise<"queued" | "duplicate"> {
    this.init();
    const stored = this.sql
      .exec(
        "INSERT INTO inbox (message_id, kind, text, received_at) VALUES (?, ?, ?, ?) ON CONFLICT (message_id) DO NOTHING RETURNING seq",
        message.id,
        message.kind,
        message.text,
        new Date().toISOString(),
      )
      .toArray();
    if (!stored.length) return "duplicate";
    this.saveAddress(message);
    await this.ctx.storage.setAlarm(Date.now());
    return "queued";
  }

  async alarm(): Promise<void> {
    this.init();
    const tried = new Set<string>();
    do {
      await this.answerInbox();
      // A /forget with nothing after it leaves the object empty, and it stays that way: no tables, no alarm.
      if (!this.ready) return;
      this.endExpiredSessions(new Date());
      await this.reflectOnEndedSessions(tried);
      await this.nudge(new Date());
      // A message that arrived during a reflection is answered before the alarm rests.
    } while (this.unhandled().length);
    await this.setNextAlarm();
  }

  /** USER.md as the person would see it. */
  getProfile(): PublicProfile {
    const { about, ...rest } = this.readUserMd();
    return { ...rest, ...splitLearned(about) };
  }

  listSessions(): SessionView[] {
    this.init();
    return this.sql
      .exec<SessionRow>("SELECT * FROM sessions ORDER BY started_at, rowid")
      .toArray()
      .map((row) => ({
        id: row.id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        end_reason: row.end_reason as EndReason | null,
        user_turns: row.user_turns,
        turns: JSON.parse(row.turns),
        facts: JSON.parse(row.facts),
        reflection: row.reflection ? JSON.parse(row.reflection) : null,
        reflection_status: !row.ended_at ? "not_ended" : row.reflected_at ? "done" : row.reflection_error ? "failed" : "pending",
      }));
  }

  /** Deletes everything this object holds: the vault, every session, the inbox, the stored number and the alarm. */
  async wipe(): Promise<void> {
    // From compatibility date 2026-02-24 deleteAll() clears the alarm too, so nothing wakes the empty object and seeds it again.
    await this.ctx.storage.deleteAll();
    this.ready = false;
  }

  // Dev tools for the terminal chat. Only the route that DEV_TOOLS switches on calls these.

  async devMemory(path?: string): Promise<DevMemory> {
    this.init();
    const rows = this.sql.exec<NoteRow>("SELECT path, frontmatter, body FROM files WHERE ? IS NULL OR path = ? ORDER BY path", path ?? null, path ?? null).toArray();
    return { notes: rows.map((row) => ({ path: row.path, frontmatter: JSON.parse(row.frontmatter), body: row.body })), state: await this.devState() };
  }

  /** Ends the open chat as if it had gone idle, then runs the alarm so it's reflected on. */
  async devEnd(): Promise<DevOutcome | "busy"> {
    this.init();
    return this.devRun((open) => open && this.endSession(open.id, "idle", new Date()));
  }

  /**
   * Pretends time has passed by moving what the deadlines are measured from back by that much, then runs the alarm. A chat's
   * start isn't moved, so the London midnight ending is never brought on this way.
   */
  async devAdvance(minutes: number): Promise<DevOutcome | "busy"> {
    this.init();
    const back = (iso: string) => new Date(Date.parse(iso) - minutes * 60_000).toISOString();
    return this.devRun((open) => {
      if (open) this.sql.exec("UPDATE sessions SET last_message_at = ? WHERE id = ?", back(open.last_message_at), open.id);
      for (const row of this.pendingReflections()) {
        if (row.reflect_after) this.sql.exec("UPDATE sessions SET reflect_after = ? WHERE id = ?", back(row.reflect_after), row.id);
      }
      const play = openPlay(this.sql);
      if (play) this.sql.exec("UPDATE files SET frontmatter = json_set(frontmatter, '$.started_at', ?) WHERE path = ?", back(play.startedAt), play.path);
    });
  }

  private async devRun(prepare: (open: SessionRow | undefined) => void): Promise<DevOutcome | "busy"> {
    // A turn that's still being answered belongs to an alarm already running, and two can't share the inbox.
    if (this.unhandled().length) return "busy";
    const snapshot = () => new Map(this.sql.exec<NoteRow>("SELECT path, frontmatter, body FROM files").toArray().map((row) => [row.path, row.frontmatter + row.body]));
    const before = snapshot();
    const open = this.openSession();
    prepare(open);
    // A real alarm run starts with none set. Without this the one being skipped past would still show as due.
    await this.ctx.storage.deleteAlarm();
    await this.alarm();
    const after = snapshot();
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
    const session = open && this.listSessions().find((s) => s.id === open.id && s.end_reason);
    const error = session ? (this.sql.exec<{ reflection_error: string | null }>("SELECT reflection_error FROM sessions WHERE id = ?", session.id).one().reflection_error) : null;
    return { changed, ended: session ? { reason: session.end_reason!, reflection: session.reflection_status, error } : null, state: await this.devState() };
  }

  private async devState(): Promise<DevState> {
    const alarm = await this.ctx.storage.getAlarm();
    return { chat_open: this.openSession() !== undefined, play_waiting: openPlay(this.sql)?.path ?? null, next_alarm: alarm === null ? null : new Date(alarm).toISOString() };
  }

  // Answering messages

  private async answerInbox(): Promise<void> {
    for (let rows = this.unhandled(); rows.length; rows = this.unhandled()) {
      const address = this.address();
      const whatsapp = address && this.channel(address.provider ?? "meta");
      if (!address || !whatsapp) {
        console.warn(JSON.stringify({ event: "brain_reply_skipped", reason: address ? "provider_not_configured" : "no_address", provider: address?.provider, messages: rows.length }));
        this.markHandled(rows);
        continue;
      }

      const forgetAt = rows.findIndex((r) => r.kind === "text" && r.text.trim().toLowerCase() === FORGET_COMMAND);
      if (forgetAt !== -1) {
        await this.forget(whatsapp, address, rows.slice(forgetAt + 1));
        if (!this.ready) return;
        continue;
      }

      const text = rows
        .filter((r) => r.kind === "text")
        .map((r) => r.text.trim())
        .join("\n");
      if (!text) {
        this.markHandled(rows);
        await this.send(whatsapp, address, REPLIES.textOnly);
        continue;
      }

      await whatsapp.markRead(rows.at(-1)!.message_id).catch((e) => this.logSendFailure("whatsapp_read_failed", e));
      const reply = this.env.ECHO_MODE?.trim().toLowerCase() === "true" ? text : await this.takeTurn(text);
      // Handled before the reply goes out: the turn is already saved, so a failed send mustn't run it twice.
      this.markHandled(rows);
      if (reply) await this.send(whatsapp, address, reply);
    }
  }

  /** Runs one turn of the open session, starting a session if there isn't one. Returns what to send back, or null for nothing. */
  private async takeTurn(text: string): Promise<string | null> {
    if (!this.env.ANTHROPIC_API_KEY) {
      console.warn(JSON.stringify({ event: "brain_turn_skipped", reason: "no_api_key" }));
      return REPLIES.unavailable;
    }
    const now = new Date();
    this.endExpiredSessions(now);
    const session = this.openSession() ?? this.startSession(now);
    try {
      const outcome = await runTurn({
        client: createClient(this.env.ANTHROPIC_API_KEY),
        model: session.model,
        context: session.context,
        messages: appendUserText(JSON.parse(session.messages), text),
        playOpen: openPlay(this.sql) !== null,
      });
      const at = now.toISOString();
      const userTurns = session.user_turns + 1;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE sessions SET messages = ?, turns = ?, facts = ?, user_turns = ?, last_message_at = ? WHERE id = ?",
          JSON.stringify(outcome.messages),
          JSON.stringify([...JSON.parse(session.turns), { role: "user", at, text } satisfies Turn, ...outcome.turns]),
          JSON.stringify([...JSON.parse(session.facts), ...outcome.facts]),
          userTurns,
          at,
          session.id,
        );
        applyPlayEvents(this.sql, outcome.plays, session.id, at);
      });
      if (userTurns >= TURN_CAP) this.endSession(session.id, "turn_cap", new Date());
      console.log(JSON.stringify({ event: "brain_turn", session_id: session.id, model: session.model, user_turns: userTurns, ...outcome.timings, usage: outcome.usage }));
      return outcome.text || null;
    } catch (e) {
      // Nothing was saved, so their next message starts from the same history. The error can't hold the prompt: the SDK only reports the API's own message.
      console.error(JSON.stringify({ event: "brain_turn_failed", session_id: session.id, model: session.model, error: String(e) }));
      return REPLIES.turnFailed;
    }
  }

  /** Wipes the object, confirms, then puts back any messages that arrived after the command so they're answered by a fresh brain. */
  private async forget(whatsapp: Channel, address: Address, later: InboxRow[]): Promise<void> {
    await this.wipe();
    console.log(JSON.stringify({ event: "brain_forgotten" }));
    await this.send(whatsapp, address, REPLIES.forgotten);
    if (!later.length) return;
    this.init();
    this.saveAddress(address);
    for (const row of later) {
      this.sql.exec("INSERT INTO inbox (message_id, kind, text, received_at) VALUES (?, ?, ?, ?)", row.message_id, row.kind, row.text, row.received_at);
    }
  }

  private async send(whatsapp: Channel, address: Address, text: string): Promise<void> {
    await whatsapp.send(address, text).catch((e) => this.logSendFailure("whatsapp_send_failed", e));
  }

  private logSendFailure(event: string, e: unknown): void {
    // Only the status and the provider's error code: the error body can quote the recipient's number.
    const detail = e instanceof WhatsAppError ? { status: e.status, code: e.code } : { error: "network" };
    console.error(JSON.stringify({ event, ...detail }));
  }

  // Sessions

  private startSession(now: Date): SessionRow {
    const at = now.toISOString();
    const row: SessionRow = {
      id: crypto.randomUUID(),
      // The model and context are fixed for the session, so a config change mid-conversation can't break the prompt cache.
      model: liveModel(this.env),
      context: this.assembleContext(at),
      messages: "[]",
      turns: "[]",
      facts: "[]",
      user_turns: 0,
      started_at: at,
      last_message_at: at,
      ended_at: null,
      end_reason: null,
      reflect_after: null,
      reflection_attempts: 0,
      reflected_at: null,
      reflection: null,
      reflection_error: null,
    };
    this.sql.exec("INSERT INTO sessions (id, model, context, started_at, last_message_at) VALUES (?, ?, ?, ?, ?)", row.id, row.model, row.context, at, at);
    return row;
  }

  private openSession(): SessionRow | undefined {
    return this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").toArray()[0];
  }

  private endExpiredSessions(now: Date): void {
    for (const row of this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE ended_at IS NULL").toArray()) {
      if (londonDate(row.started_at) !== londonDate(now.toISOString())) this.endSession(row.id, "midnight", now);
      else if (now.getTime() - Date.parse(row.last_message_at) >= this.idleMs) this.endSession(row.id, "idle", now);
    }
  }

  /** Closes a session and queues its reflection. A session nothing was said in (its only turn failed) is just dropped. */
  private endSession(id: string, reason: EndReason, now: Date): void {
    const at = now.toISOString();
    this.sql.exec("DELETE FROM sessions WHERE id = ? AND user_turns = 0", id);
    this.sql.exec("UPDATE sessions SET ended_at = ?, end_reason = ?, reflect_after = ? WHERE id = ? AND ended_at IS NULL", at, reason, at, id);
  }

  private assembleContext(at: string): string {
    const { preferences, about } = this.readUserMd();
    const sessionNotes = this.sql.exec<NoteRow>("SELECT path, frontmatter, body FROM files WHERE kind = 'session' ORDER BY path DESC LIMIT ?", MAX_SESSION_NOTES).toArray();
    const plays = this.sql.exec<NoteRow>("SELECT path, frontmatter, body FROM files WHERE kind = 'play' ORDER BY json_extract(frontmatter, '$.started_at') DESC LIMIT ?", MAX_PLAY_NOTES).toArray();
    return assembleContext({
      user: { preferences, about },
      interests: readFile(this.sql, INTERESTS_MD)?.body ?? null,
      memory: readFile(this.sql, MEMORY_MD)?.body ?? null,
      plays: plays as Note[],
      openPlay: openPlay(this.sql)?.path ?? null,
      sessionNotes: sessionNotes as Note[],
      time: londonTime(at),
      today: londonDay(at),
    });
  }

  // Reflection

  private pendingReflections(): SessionRow[] {
    return this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE ended_at IS NOT NULL AND reflected_at IS NULL AND reflection_error IS NULL ORDER BY ended_at, rowid").toArray();
  }

  /** Reflects on every ended session that's due. A failure worth retrying is pushed back; one that isn't is saved as failed. */
  private async reflectOnEndedSessions(tried: Set<string>): Promise<void> {
    const due = this.pendingReflections().filter((row) => !tried.has(row.id) && Date.parse(row.reflect_after ?? row.ended_at!) <= Date.now());
    if (!due.length) return;
    if (!this.env.ANTHROPIC_API_KEY) {
      console.warn(JSON.stringify({ event: "brain_reflection_skipped", reason: "no_api_key", pending: due.length }));
      return;
    }
    const client = createClient(this.env.ANTHROPIC_API_KEY, REFLECTION_TIMEOUT_MS);
    for (const row of due) {
      tried.add(row.id);
      try {
        await this.reflectOn(client, row);
      } catch (e) {
        const wait = REFLECTION_RETRY_MINUTES[row.reflection_attempts];
        const retryable = isRetryable(e) && wait !== undefined;
        console.error(JSON.stringify({ event: "brain_reflection_failed", session_id: row.id, retryable, attempt: row.reflection_attempts + 1, error: String(e) }));
        if (retryable) {
          this.sql.exec("UPDATE sessions SET reflection_attempts = reflection_attempts + 1, reflect_after = ? WHERE id = ?", new Date(Date.now() + wait * 60_000).toISOString(), row.id);
        } else {
          this.sql.exec("UPDATE sessions SET reflection_error = ? WHERE id = ?", e instanceof Error ? e.message : String(e), row.id);
        }
      }
    }
  }

  private async reflectOn(client: Anthropic, row: SessionRow): Promise<void> {
    const started = Date.now();
    const { preferences, about } = this.readUserMd();
    const { reflection, usage } = await reflect(client, { user: { preferences, about }, interests: readFile(this.sql, INTERESTS_MD)?.body ?? null, turns: JSON.parse(row.turns), facts: JSON.parse(row.facts) });
    const note = this.ctx.storage.transactionSync(() => {
      const current = this.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id = ?", row.id).toArray()[0];
      if (!current || current.reflected_at) return null;
      const now = new Date().toISOString();
      const path = writeReflection(this.sql, { id: row.id, started_at: row.started_at, reflection }, now);
      const saved: SavedReflection = { ...reflection, note: path };
      this.sql.exec("UPDATE sessions SET reflected_at = ?, reflection = ? WHERE id = ?", now, JSON.stringify(saved), row.id);
      return path;
    });
    console.log(JSON.stringify({ event: "brain_reflection", session_id: row.id, note, total_ms: Date.now() - started, usage }));
  }

  // The nudge

  /**
   * Asks once how the open play session went, a while after it was meant to end. It waits for the chat to go quiet first,
   * so the question never lands in the middle of a conversation whose stored context doesn't know about it.
   */
  private async nudge(now: Date): Promise<void> {
    const play = openPlay(this.sql);
    if (!play || play.nudgedAt || this.openSession() || now.getTime() < nudgeDue(play, this.nudgeAfterMinutes)) return;
    const address = this.address();
    const whatsapp = address && this.channel(address.provider ?? "meta");
    if (!address || !whatsapp) return;
    // Marked before it goes out, so a send that fails isn't tried again and again.
    markNudged(this.sql, play.path, now.toISOString());
    await this.send(whatsapp, address, REPLIES.nudge(play.activity));
    console.log(JSON.stringify({ event: "brain_nudge", play: play.path }));
  }

  // The alarm

  /** The Durable Object has one alarm, so it's set for whichever comes first: the open session going idle, London midnight, a reflection retry, or the nudge. */
  private async setNextAlarm(): Promise<void> {
    const now = Date.now();
    const deadlines: number[] = [];
    const open = this.openSession();
    if (open) deadlines.push(Date.parse(open.last_message_at) + this.idleMs, Date.parse(nextLondonMidnight(new Date(now).toISOString())));
    const play = openPlay(this.sql);
    if (play && !play.nudgedAt && !open) deadlines.push(nudgeDue(play, this.nudgeAfterMinutes));
    if (this.env.ANTHROPIC_API_KEY) deadlines.push(...this.pendingReflections().map((row) => Date.parse(row.reflect_after ?? row.ended_at!)));
    this.sql.exec("DELETE FROM inbox WHERE handled_at IS NOT NULL AND handled_at < ?", new Date(now - INBOX_KEEP_MS).toISOString());
    // Nothing is awaited between the last inbox check and this, so no message slips in unanswered; one arriving later sets the alarm to now itself.
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Math.min(...deadlines), now + 1_000));
  }

  // Storage helpers

  private unhandled(): InboxRow[] {
    return this.sql.exec<InboxRow>("SELECT seq, message_id, kind, text, received_at FROM inbox WHERE handled_at IS NULL ORDER BY seq").toArray();
  }

  /** Keeps the id, to spot a repeat delivery, and drops the text: the transcript on the session is the only copy. */
  private markHandled(rows: InboxRow[]): void {
    const at = new Date().toISOString();
    for (const row of rows) this.sql.exec("UPDATE inbox SET handled_at = ?, text = '' WHERE seq = ?", at, row.seq);
  }

  /** The object is named by a hash, so it keeps the number (or user id) it needs to reply to. It's never logged, and /forget deletes it. */
  private saveAddress({ phone, userId, provider }: Address): void {
    const save = (key: string, value: string | null) => {
      if (value) this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
    };
    save("phone", phone);
    save("user_id", userId);
    // Replies go back the way the person's latest message came in.
    save("provider", provider ?? "meta");
  }

  private address(): Address | null {
    const get = (key: string) => this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? null;
    const address: Address = { phone: get("phone"), userId: get("user_id"), provider: get("provider") === "twilio" ? "twilio" : "meta" };
    return address.phone || address.userId ? address : null;
  }

  /** The send side of a provider, or null while its secrets aren't set. */
  private channel(provider: Provider): Channel | null {
    if (provider === "twilio") {
      const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_WHATSAPP_FROM: from } = this.env;
      if (!accountSid || !authToken || !from) return null;
      const config = { accountSid, authToken, from, gapMs: TWILIO_SEND_GAP_MS };
      return {
        send: async (to, text) => {
          if (to.phone) await sendTwilioText(config, to.phone, text);
        },
        // Twilio's sandbox has no read receipt or typing indicator to set.
        markRead: async () => {},
      };
    }
    const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, WHATSAPP_API_VERSION: apiVersion, WHATSAPP_API_BASE: apiBase } = this.env;
    if (!token || !phoneNumberId || !apiVersion) return null;
    const config = { token, phoneNumberId, apiVersion, apiBase };
    return { send: (to, text) => sendText(config, to, text), markRead: (messageId) => markReadAndTyping(config, messageId) };
  }

  private readUserMd(): Profile {
    this.init();
    const row = this.sql.exec<{ frontmatter: string; body: string; updated_at: string }>("SELECT frontmatter, body, updated_at FROM files WHERE path = ?", USER_MD).toArray()[0];
    if (!row) return { preferences: {}, about: "", updated_at: new Date(0).toISOString() };
    return { preferences: JSON.parse(row.frontmatter) as Preferences, about: row.body, updated_at: row.updated_at };
  }
}
