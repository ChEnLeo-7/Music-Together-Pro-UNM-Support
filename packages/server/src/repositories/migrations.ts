import type { Database } from 'better-sqlite3'

interface Migration {
  version: number
  sql?: string
  apply?: (db: Database) => void
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
    apply: (db) => {
      const requiredColumns = [
        { name: 'password_ciphertext', definition: 'TEXT', type: 'TEXT', notnull: 0, defaultValue: null },
        { name: 'password_nonce', definition: 'TEXT', type: 'TEXT', notnull: 0, defaultValue: null },
        { name: 'password_tag', definition: 'TEXT', type: 'TEXT', notnull: 0, defaultValue: null },
        { name: 'password_key_version', definition: 'INTEGER', type: 'INTEGER', notnull: 0, defaultValue: null },
        {
          name: 'password_version',
          definition: 'INTEGER NOT NULL DEFAULT 0',
          type: 'INTEGER',
          notnull: 1,
          defaultValue: '0',
        },
      ] as const

      const currentColumns = () =>
        new Map(
          (
            db.prepare('PRAGMA table_info(rooms)').all() as Array<{
              name: string
              type: string
              notnull: 0 | 1
              dflt_value: string | null
            }>
          ).map((column) => [column.name.toLowerCase(), column]),
        )

      const existingColumns = currentColumns()
      for (const column of requiredColumns) {
        if (!existingColumns.has(column.name)) {
          db.exec(`ALTER TABLE rooms ADD COLUMN ${column.name} ${column.definition}`)
        }
      }

      const finalColumns = currentColumns()
      for (const expected of requiredColumns) {
        const actual = finalColumns.get(expected.name)
        const normalizedDefault = actual?.dflt_value?.replace(/[()']/g, '') ?? null
        if (
          !actual ||
          actual.type.toUpperCase() !== expected.type ||
          actual.notnull !== expected.notnull ||
          normalizedDefault !== expected.defaultValue
        ) {
          throw new Error(`Database rooms.${expected.name} has an incompatible definition`)
        }
      }

      const corrupted = db.prepare(`
        SELECT id FROM rooms
        WHERE (
          (password_ciphertext IS NOT NULL) +
          (password_nonce IS NOT NULL) +
          (password_tag IS NOT NULL) +
          (password_key_version IS NOT NULL)
        ) NOT IN (0, 4)
        LIMIT 1
      `).get() as { id: string } | undefined
      if (corrupted) {
        throw new Error(`Room ${corrupted.id} has a partial encrypted password credential`)
      }
    },
  },
  {
    version: 4,
    sql: `
      CREATE TABLE room_media (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('upload', 'direct-url', 'yt-dlp')),
        status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed', 'deleted')),
        storage_path TEXT,
        cover_path TEXT,
        source_url TEXT,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        byte_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        title TEXT NOT NULL DEFAULT '',
        artist_json TEXT NOT NULL DEFAULT '[]',
        album TEXT NOT NULL DEFAULT '',
        duration_seconds REAL NOT NULL DEFAULT 0,
        lyrics_text TEXT,
        translated_lyrics_text TEXT,
        lyric_source TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_referenced_at INTEGER NOT NULL,
        last_accessed_at INTEGER,
        failed_at INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX room_media_room_status_idx ON room_media(room_id, status);
      CREATE INDEX room_media_cleanup_idx ON room_media(status, last_referenced_at, last_accessed_at);

      CREATE TABLE room_media_credentials (
        room_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('youtube', 'bilibili')),
        cookie_encrypted TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, platform)
      );
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
      if (migration.apply) migration.apply(db)
      else if (migration.sql) db.exec(migration.sql)
      insertVersion.run(migration.version, Date.now())
    })()
  }
}

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
