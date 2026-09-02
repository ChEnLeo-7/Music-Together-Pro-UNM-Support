import assert from 'node:assert/strict'
import test from 'node:test'
import { canConfigureRoomUnm } from './runtimeConfigService.js'

test('room creators and server administrators can configure the room UNM server', () => {
  assert.equal(canConfigureRoomUnm('owner-id', 'owner-id', false), true)
  assert.equal(canConfigureRoomUnm('owner-id', 'server-admin-id', true), true)
  assert.equal(canConfigureRoomUnm('owner-id', 'room-admin-id', false), false)
  assert.equal(canConfigureRoomUnm('owner-id', undefined, false), false)
  assert.equal(canConfigureRoomUnm('owner-id', 'owner-id', false, false), false)
  assert.equal(canConfigureRoomUnm('owner-id', 'server-admin-id', true, false), false)
})
