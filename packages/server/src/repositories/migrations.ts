import type { Database } from 'better-sqlite3'

interface Migration {
  version: number
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('guest', 'account')),
        username TEXT COLLATE BINARY,
        nickname TEXT NOT NULL DEFAULT '',
        avatar_url TEXT,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        CHECK (
          (kind = 'guest' AND username IS NULL AND password_hash IS NULL)
          OR (kind = 'account' AND username IS NOT NULL AND password_hash IS NOT NULL)
        )
      );
      CREATE UNIQUE INDEX users_username_unique ON users(username COLLATE BINARY) WHERE username IS NOT NULL;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

      CREATE TABLE platform_auth (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        room_id TEXT,
        platform TEXT NOT NULL,
        cookie_encrypted TEXT NOT NULL,
        persist_policy TEXT NOT NULL DEFAULT 'room',
        nickname_snapshot TEXT,
        vip_type INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        password_hash TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        permanent INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        dissolved_at INTEGER,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE room_members (
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        nickname_snapshot TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member',
        online INTEGER NOT NULL DEFAULT 0,
        joined_at INTEGER NOT NULL,
        left_at INTEGER,
        PRIMARY KEY (room_id, user_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE users ADD COLUMN must_change_username INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE rooms ADD COLUMN password_ciphertext TEXT;
      ALTER TABLE rooms ADD COLUMN password_nonce TEXT;
      ALTER TABLE rooms ADD COLUMN password_tag TEXT;
      ALTER TABLE rooms ADD COLUMN password_key_version INTEGER;
      ALTER TABLE rooms ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
    `,
  },
]

function hasTable(db: Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

export function runMigrations(db: Database): void {
  if (!hasTable(db, 'schema_migrations')) {
    const existingApplicationTables = ['users', 'sessions', 'rooms', 'platform_auth', 'room_members'].some((table) => hasTable(db, table))
    if (existingApplicationTables) {
      throw new Error('Unversioned database schema detected. Run the explicit account:reset command after taking a backup.')
    }
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  }

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => row.version),
  )
  const unknown = [...applied].find((version) => !migrations.some((migration) => migration.version === version))
  if (unknown !== undefined) throw new Error(`Database schema version ${unknown} is newer than this server supports`)
  const insertVersion = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      insertVersion.run(migration.version, Date.now())
    })()
  }
}

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
