import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { latestSchemaVersion, runMigrations } from './migrations.js'

test('migrations create a versioned schema and are idempotent', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  runMigrations(database)

  const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
  assert.deepEqual(versions, Array.from({ length: latestSchemaVersion }, (_, index) => ({ version: index + 1 })))
  assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get())
  const roomColumns = database.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>
  assert.ok(roomColumns.some(({ name }) => name === 'password_ciphertext'))
  assert.ok(roomColumns.some(({ name }) => name === 'password_version'))
})

test('migrations reject an unversioned application database instead of mutating it', () => {
  const database = new Database(':memory:')
  database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)')

  assert.throws(() => runMigrations(database), /Unversioned database schema detected/)
  assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(), undefined)
})

test('v3 accepts databases where an older image already created encrypted password columns', () => {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2);
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      password_ciphertext TEXT,
      password_nonce TEXT,
      password_tag TEXT,
      password_key_version INTEGER,
      password_version INTEGER NOT NULL DEFAULT 0
    );
  `)

  runMigrations(database)

  const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
  assert.deepEqual(versions, [{ version: 1 }, { version: 2 }, { version: 3 }])
  const roomColumns = database.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>
  assert.equal(roomColumns.filter(({ name }) => name === 'password_ciphertext').length, 1)
})

test('v3 adds only missing encrypted password columns', () => {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, PASSWORD_CIPHERTEXT TEXT);
  `)

  runMigrations(database)

  const columns = database.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>
  assert.equal(columns.filter(({ name }) => name.toLowerCase() === 'password_ciphertext').length, 1)
  assert.ok(columns.some(({ name }) => name === 'password_version'))
})

test('v3 rejects incompatible existing column definitions without recording the version', () => {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, password_ciphertext TEXT NOT NULL);
  `)

  assert.throws(() => runMigrations(database), /incompatible definition/)
  assert.equal(database.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get(), undefined)
})

test('v3 rejects partial encrypted credentials without recording the version', () => {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, password_ciphertext TEXT);
    INSERT INTO rooms (id, password_ciphertext) VALUES ('partial-room', 'ciphertext');
  `)

  assert.throws(() => runMigrations(database), /partial encrypted password credential/)
  assert.equal(database.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get(), undefined)
})
