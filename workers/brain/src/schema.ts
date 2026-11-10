/** Append-only: once the Worker has been deployed, never edit a migration, add a new one. */
const migrations: string[] = [
  `
  CREATE TABLE files (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('user', 'memory', 'session', 'interests', 'play')),
    frontmatter TEXT NOT NULL DEFAULT '{}',
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE links (
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (src, dst, kind)
  );
  CREATE INDEX links_dst ON links (dst);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    context TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    turns TEXT NOT NULL DEFAULT '[]',
    facts TEXT NOT NULL DEFAULT '[]',
    user_turns INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    ended_at TEXT,
    end_reason TEXT,
    reflect_after TEXT,
    reflection_attempts INTEGER NOT NULL DEFAULT 0,
    reflected_at TEXT,
    reflection TEXT,
    reflection_error TEXT
  );
  CREATE INDEX sessions_ended_at ON sessions (ended_at);

  CREATE TABLE inbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'unsupported')),
    text TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL,
    handled_at TEXT
  );
  CREATE INDEX inbox_handled_at ON inbox (handled_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = migrations.length;

/** Applies pending migrations and returns the version the database started at. */
export function migrate(sql: SqlStorage, now: string): number {
  sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const from = sql.exec<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").one().version;
  for (let version = from + 1; version <= migrations.length; version++) {
    sql.exec(migrations[version - 1]);
    sql.exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", version, now);
  }
  return from;
}
