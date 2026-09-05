import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMediaToken, createRoomMediaToken, verifyMediaToken, verifyRoomMediaToken } from './mediaToken.js'

test('room media tokens are bound to the exact media and room', () => {
  const token = createRoomMediaToken('media-1', 'room-1', 1_000)

  assert.equal(verifyRoomMediaToken(token, 'media-1', 'room-1', 1_000), true)
  assert.equal(verifyRoomMediaToken(token, 'media-2', 'room-1', 1_000), false)
  assert.equal(verifyRoomMediaToken(token, 'media-1', 'room-2', 1_000), false)
  assert.equal(verifyRoomMediaToken(token, 'media-1', 'room-1', 604_801_001), false)
})

test('user media tokens cannot be reused by another user', () => {
  const token = createMediaToken('media-1', 'room-1', 'user-1', 1_000)

  assert.equal(verifyMediaToken(token, 'media-1', 'room-1', 'user-1', 1_000), true)
  assert.equal(verifyMediaToken(token, 'media-1', 'room-1', 'user-2', 1_000), false)
  assert.equal(verifyMediaToken(`${token}tampered`, 'media-1', 'room-1', 'user-1', 1_000), false)
})

test('media tokens expire at their expiration timestamp', () => {
  const token = createRoomMediaToken('media-1', 'room-1', 1_000)

  assert.equal(verifyRoomMediaToken(token, 'media-1', 'room-1', 604_800_999), true)
  assert.equal(verifyRoomMediaToken(token, 'media-1', 'room-1', 604_801_000), false)
})
