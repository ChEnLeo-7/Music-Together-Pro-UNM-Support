import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertPublicHttpUrl } from './publicUrl.js'

test('stream proxy rejects loopback and unsupported URLs', async () => {
  await assert.rejects(assertPublicHttpUrl('http://127.0.0.1/private'), /non-public/)
  await assert.rejects(assertPublicHttpUrl('file:///etc/passwd'), /Unsupported/)
  await assert.rejects(assertPublicHttpUrl('http://user:password@example.com/audio'), /Unsupported/)
})
