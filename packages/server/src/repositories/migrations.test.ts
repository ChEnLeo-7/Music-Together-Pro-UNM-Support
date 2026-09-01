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
