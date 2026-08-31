import assert from 'node:assert/strict'
import test from 'node:test'
import { canConfirmPendingSeek, displayTimeForSnapshot } from './pendingSeek'

test('old native snapshots cannot replace a pending seek target', () => {
  assert.equal(displayTimeForSnapshot(10.2, 60), 60)
  assert.equal(displayTimeForSnapshot(10.3, 60), 60)
  assert.equal(displayTimeForSnapshot(60.1, null), 60.1)
})

test('only the current playback revision confirms a native seek', () => {
  assert.equal(canConfirmPendingSeek(7, 8), false)
  assert.equal(canConfirmPendingSeek(8, 8), true)
  assert.equal(canConfirmPendingSeek(undefined, 8), false)
  assert.equal(canConfirmPendingSeek(8, null), false)
})
