#!/usr/bin/env node
// Chat to the Worker running under `npm run dev` from a terminal, with no WhatsApp account. This script plays Meta on both
// sides: it posts signed webhooks in, and it is the "Graph API" the Worker sends its replies to (WHATSAPP_API_BASE).
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const WEBHOOK_PATH = "/poppy/api/whatsapp";
const DEV_PATH = "/poppy/api/dev";
const DEV_COMMAND = /^\/(memory|end|advance)(?:\s+(.*))?$/;
const UNIT_MINUTES = { s: 1 / 60, m: 1, h: 60, d: 24 * 60 };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const QUIET_HINT_MS = 45_000;
const PIPED_SETTLE_MS = 1_500;
const PIPED_GIVE_UP_MS = 90_000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readDevVars() {
  let text;
  try {
    text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  } catch {
    fail("No .dev.vars here. Run `cp .dev.vars.example .dev.vars` in workers/brain and fill it in (the README says how).");
  }
  const vars = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) vars[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}

const { values: options } = parseArgs({
  options: { as: { type: "string", default: "me" }, worker: { type: "string", default: "http://localhost:8787" }, help: { type: "boolean", short: "h" } },
});
if (options.help) {
  console.log("Usage: npm run chat -- [--as <name>] [--worker <url>]\n\n  --as <name>     chat as a different made-up family, each with its own memory (default: me)\n  --worker <url>  where `npm run dev` is listening (default: http://localhost:8787)");
  process.exit(0);
}

const vars = readDevVars();
const missing = ["WHATSAPP_APP_SECRET", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_BASE"].filter((name) => !vars[name]);
if (missing.length) fail(`.dev.vars is missing ${missing.join(", ")}. Any made-up values do, and WHATSAPP_API_BASE=http://127.0.0.1:8788 is a good one.`);

let apiBase;
try {
  apiBase = new URL(vars.WHATSAPP_API_BASE);
} catch {
  fail("WHATSAPP_API_BASE in .dev.vars isn't a URL. Try http://127.0.0.1:8788.");
}
if (apiBase.protocol !== "http:" || !LOCAL_HOSTS.has(apiBase.hostname) || !apiBase.port) {
  fail("WHATSAPP_API_BASE in .dev.vars has to be this machine with a port, for example http://127.0.0.1:8788.");
}

const name = options.as.trim() || "me";
// Meta's business-scoped user id is the whole identity, so no phone number is needed, made up or otherwise.
const userId = `GB.FAKE${createHash("sha256").update(name).digest("hex").slice(0, 24).toUpperCase()}`;
const webhookUrl = new URL(WEBHOOK_PATH, options.worker).href;
const interactive = process.stdin.isTTY;

let waitingForReply = false;
let lastActivity = Date.now();
let quietHint;

let readline;

function show(line) {
  if (interactive) process.stdout.write("\r\x1b[K");
  console.log(line);
  if (interactive) readline?.prompt(true);
}

function webhookFor(text) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000002",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "terminal", phone_number_id: vars.WHATSAPP_PHONE_NUMBER_ID },
              contacts: [{ profile: { name }, user_id: userId }],
              messages: [{ from_user_id: userId, id: `wamid.terminal-${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

async function post(url, raw) {
  const signature = `sha256=${createHmac("sha256", vars.WHATSAPP_APP_SECRET).update(raw).digest("hex")}`;
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }, body: raw });
  } catch {
    fail(`\nThe Worker at ${options.worker} stopped answering. Is \`npm run dev\` still running?`);
  }
}

const londonTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London" });

function showState({ chat_open, play_waiting, next_alarm }) {
  show(`(chat: ${chat_open ? "open" : "none open"}. play waiting for a check-in: ${play_waiting ?? "none"}. next alarm: ${next_alarm ? `${londonTime(next_alarm)} UK time` : "none"})`);
}

function showNote({ path, frontmatter, body }) {
  show(`\n=== ${path}`);
  if (Object.keys(frontmatter ?? {}).length) show(JSON.stringify(frontmatter, null, 2));
  if (body.trim()) show(body.trimEnd());
}

function showOutcome({ changed, ended, state }) {
  if (ended) {
    const reflection = { done: "reflected on", failed: `reflection failed (${ended.error})`, pending: "reflection still waiting, the `npm run dev` terminal says why" }[ended.reflection];
    show(`(the chat ended: ${ended.reason}, ${reflection})`);
  }
  show(`(notes changed: ${changed.length ? changed.join(", ") : "none"})`);
  showState(state);
}

/** /memory, /end and /advance go to the Worker's dev route, not into the conversation. */
async function devCommand(command, argument = "") {
  if (vars.DEV_TOOLS?.toLowerCase() !== "true") return show(`(/${command} needs DEV_TOOLS=true in .dev.vars, then restart \`npm run dev\`)`);
  const request = { user_id: userId, command };
  if (command === "memory" && argument) request.path = argument;
  if (command === "advance") {
    const duration = argument.match(/^(\d+(?:\.\d+)?)([smhd])$/);
    if (!duration || !Number(duration[1])) return show("(say how long, like /advance 45m or /advance 2h)");
    request.minutes = Number(duration[1]) * UNIT_MINUTES[duration[2]];
  }
  for (const started = Date.now(); waitingForReply && Date.now() - started < QUIET_HINT_MS; ) await new Promise((resolve) => setTimeout(resolve, 100));

  const response = await post(new URL(DEV_PATH, options.worker).href, JSON.stringify(request));
  if (response.status === 404) return show("(the Worker doesn't have its dev tools on. Restart `npm run dev` so it reads DEV_TOOLS from .dev.vars)");
  if (response.status === 409) return show("(Poppy is still busy with a message. Try again in a moment)");
  if (!response.ok) return show(`(the Worker answered ${response.status} to /${command})`);
  const result = await response.json();
  lastActivity = Date.now();
  if (command !== "memory") return showOutcome(result);
  if (!result.notes.length) show(argument ? `(no note at ${argument})` : "(the vault is empty)");
  result.notes.forEach(showNote);
  showState(result.state);
}

async function say(text) {
  const response = await post(webhookUrl, webhookFor(text));
  if (response.status === 401 || response.status === 503) {
    fail("\nThe Worker turned the message away: its WHATSAPP_APP_SECRET isn't the one in .dev.vars. Restart `npm run dev` so it reads the file again.");
  }
  if (!response.ok) fail(`\nThe Worker answered ${response.status}. Its terminal says why.`);
  waitingForReply = true;
  lastActivity = Date.now();
  clearTimeout(quietHint);
  quietHint = setTimeout(() => {
    if (waitingForReply) show("(nothing back yet. Look for whatsapp_send_failed or brain_turn_failed in the `npm run dev` terminal, and restart it if .dev.vars changed since it started)");
  }, QUIET_HINT_MS);
  quietHint.unref();
}

const fakeGraph = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let sent = null;
    try {
      sent = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {}
    response.setHeader("Content-Type", "application/json");
    if (request.method !== "POST" || !sent) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: { code: 100, message: "The terminal chat only takes the messages call." } }));
      return;
    }
    const picture = sent.type === "image" && typeof sent.image?.link === "string" ? `[picture: ${sent.image.link}]` : null;
    const body = picture ? [picture, sent.image.caption].filter(Boolean).join("\n") : sent.type === "text" ? sent.text?.body : null;
    if (typeof body === "string") {
      const to = sent.recipient ?? sent.to;
      show(`${to === userId ? "poppy" : "poppy, to another family"}> ${body}`);
      if (to === userId) waitingForReply = false;
      lastActivity = Date.now();
    }
    response.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.terminal-reply-${randomUUID()}` }] }));
  });
});

fakeGraph.on("error", (e) => {
  fail(e.code === "EADDRINUSE" ? `Port ${apiBase.port} is taken. Is another \`npm run chat\` still open? Only one can listen for replies at a time.` : `Couldn't listen on ${apiBase.host}: ${e.message}`);
});

try {
  await fetch(webhookUrl);
} catch {
  fail(`Nothing is answering at ${options.worker}. Start the Worker with \`npm run dev\` in another terminal first.`);
}

await new Promise((resolve) => fakeGraph.listen(Number(apiBase.port), apiBase.hostname.replace(/^\[|\]$/g, ""), resolve));

// Made only once everything is ready: piped lines read any earlier would arrive before there's anything listening for them.
readline = createInterface({ input: process.stdin, output: process.stdout, prompt: `${name}> `, terminal: interactive });

if (interactive) console.log(`Chatting to Poppy as "${name}". /forget wipes this family's memory, Ctrl-C leaves. With DEV_TOOLS on: /memory, /end, /advance 45m.\n`);

let sending = Promise.resolve();
readline.on("line", (line) => {
  const text = line.trim();
  const dev = text.match(DEV_COMMAND);
  if (dev) sending = sending.then(() => devCommand(dev[1], dev[2]?.trim()));
  else if (text) sending = sending.then(() => say(text));
  if (interactive) readline.prompt();
});

readline.on("close", async () => {
  if (interactive) process.exit(0);
  // Piped input ends before the replies come back, so wait for them.
  await sending;
  const started = Date.now();
  setInterval(() => {
    if (!waitingForReply && Date.now() - lastActivity >= PIPED_SETTLE_MS) process.exit(0);
    if (Date.now() - started >= PIPED_GIVE_UP_MS) fail("Gave up waiting for a reply. The `npm run dev` terminal says what went wrong.");
  }, 250);
});

if (interactive) readline.prompt();
