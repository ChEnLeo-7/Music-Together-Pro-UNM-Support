import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { runMigrations } from '../repositories/migrations.js'
import { createSessionRepository } from '../repositories/sessionRepository.js'
import { createUserRepository } from '../repositories/userRepository.js'
import { createAccountAuth, AccountAuthError } from './accountAuth.js'
import { createSessionManager } from './sessionManager.js'

function setup(options: { initialized?: boolean } = {}) {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  const users = createUserRepository(db)
  if (options.initialized !== false) {
    users.create({
      id: 'initial-admin',
      kind: 'account',
      username: 'InitialAdmin',
      nickname: 'Admin',
      passwordHash: 'not-used',
      role: 'admin',
    })
  }
  const sessions = createSessionRepository(db)
  const sessionManager = createSessionManager(sessions, users, { ttlMs: 30 * 24 * 60 * 60 * 1000 })
  const accountAuth = createAccountAuth(users, sessionManager, { bcryptRounds: 4 })
  return { db, users, sessions, sessionManager, accountAuth }
}

test('public registration is unavailable until a local administrator exists', async () => {
  const { accountAuth } = setup({ initialized: false })
  await assert.rejects(
    accountAuth.register({ username: 'FirstUser', password: '0123456789', nickname: 'First' }),
    (error: unknown) => error instanceof AccountAuthError && error.code === 'REGISTRATION_UNAVAILABLE',
  )
})

test('registration enforces username rules and preserves case-sensitive uniqueness', async () => {
  const { accountAuth } = setup()

  await assert.rejects(
    accountAuth.register({ username: 'ab', password: '0123456789', nickname: 'short' }),
    (error: unknown) => error instanceof AccountAuthError && error.code === 'INVALID_USERNAME',
  )

  const upper = await accountAuth.register({ username: 'Foo', password: '0123456789', nickname: 'Upper' })
  const lower = await accountAuth.register({ username: 'foo', password: '0123456789', nickname: 'Lower' })
  assert.notEqual(upper.user.id, lower.user.id)

  await assert.rejects(
    accountAuth.register({ username: ' Foo ', password: '0123456789', nickname: 'duplicate' }),
    (error: unknown) => error instanceof AccountAuthError && error.code === 'USERNAME_TAKEN',
  )
})

test('guest registration upgrades the same stable internal user id', async () => {
  const { accountAuth, sessionManager } = setup()
  const guest = await accountAuth.createGuest('Guest')
  const principal = await sessionManager.authenticate(guest.session.token)
  assert.ok(principal)

  const account = await accountAuth.register(
    { username: 'Guest_1', password: '0123456789', nickname: 'Registered' },
    principal.session,
  )

  assert.equal(account.user.id, guest.user.id)
  assert.equal(account.user.kind, 'account')
  assert.equal(await sessionManager.authenticate(guest.session.token), null)
  assert.ok(await sessionManager.authenticate(account.session.token))
})

test('database stores only a session token hash and logout revokes it', async () => {
  const { accountAuth, db, sessionManager } = setup()
  const result = await accountAuth.createGuest('Guest')
  const row = db.prepare('SELECT token_hash, revoked_at FROM sessions').get() as {
    token_hash: string
    revoked_at: number | null
  }

  assert.notEqual(row.token_hash, result.session.token)
  assert.equal(row.token_hash.length, 64)
  await accountAuth.logout(result.session.id)
  assert.equal(await sessionManager.authenticate(result.session.token), null)
})

test('password change rotates all sessions and clears mustChangePassword', async () => {
  const { accountAuth, sessionManager } = setup()
  const registered = await accountAuth.register({ username: 'CaseUser', password: 'old-password', nickname: 'Case' })
  const second = await accountAuth.login('CaseUser', 'old-password')
  const changed = await accountAuth.changePassword(registered.user.id, 'old-password', 'new-password')

  assert.equal(await sessionManager.authenticate(registered.session.token), null)
  assert.equal(await sessionManager.authenticate(second.session.token), null)
  assert.ok(await sessionManager.authenticate(changed.session.token))
  await assert.rejects(accountAuth.login('CaseUser', 'old-password'), (error: unknown) => {
    return error instanceof AccountAuthError && error.code === 'INVALID_CREDENTIALS'
  })
})

test('administrator reset marks account and revokes every session', async () => {
  const { accountAuth, sessionManager, users } = setup()
  const registered = await accountAuth.register({ username: 'ResetMe', password: 'old-password', nickname: 'Reset' })

  await accountAuth.resetPasswordByAdmin(registered.user.id, 'temporary-password')

  assert.equal(await sessionManager.authenticate(registered.session.token), null)
  assert.equal(users.get(registered.user.id)?.mustChangePassword, true)
  const loggedIn = await accountAuth.login('ResetMe', 'temporary-password')
  assert.equal(loggedIn.user.mustChangePassword, true)
})

test('unknown username and wrong password use the same external error', async () => {
  const { accountAuth } = setup()
  await accountAuth.register({ username: 'KnownUser', password: 'known-password', nickname: 'Known' })

  for (const username of ['MissingUser', 'KnownUser']) {
    await assert.rejects(accountAuth.login(username, 'wrong-password'), (error: unknown) => {
      return error instanceof AccountAuthError && error.code === 'INVALID_CREDENTIALS'
    })
  }
})

test('deleting a user invalidates old tokens without recreating the user', async () => {
  const { accountAuth, sessionManager, users } = setup()
  const registered = await accountAuth.register({
    username: 'DeleteMe',
    password: 'delete-password',
    nickname: 'Delete',
  })

  assert.equal(users.delete(registered.user.id), true)
  assert.equal(await sessionManager.authenticate(registered.session.token), null)
  assert.equal(users.get(registered.user.id), null)
})

test('concurrent password changes cannot both replace the same credential', async () => {
  const { accountAuth } = setup()
  const registered = await accountAuth.register({
    username: 'Concurrent',
    password: 'old-password',
    nickname: 'Concurrent',
  })

  const results = await Promise.allSettled([
    accountAuth.changePassword(registered.user.id, 'old-password', 'new-password-a'),
    accountAuth.changePassword(registered.user.id, 'old-password', 'new-password-b'),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
})

test('bootstrap administrator must replace both username and password', async () => {
  const { accountAuth, users } = setup()
  const bootstrap = users.create({
    id: 'bootstrap-admin',
    kind: 'account',
    username: 'BootstrapAdmin',
    nickname: 'Bootstrap',
    passwordHash: await bcrypt.hash('admin', 4),
    role: 'admin',
    mustChangePassword: true,
    mustChangeUsername: true,
  })

  const changed = await accountAuth.changeBootstrapCredentials(bootstrap.id, 'NewAdmin', 'new-password')
  assert.equal(changed.user.username, 'NewAdmin')
  assert.equal(changed.user.mustChangeUsername, false)
  assert.equal(changed.user.mustChangePassword, false)
})
