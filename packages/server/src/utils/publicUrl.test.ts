import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertPublicHttpUrl } from './publicUrl.js'

test('stream proxy rejects loopback and unsupported URLs', async () => {
  await assert.rejects(assertPublicHttpUrl('http://127.0.0.1/private'), /non-public/)
  await assert.rejects(assertPublicHttpUrl('file:///etc/passwd'), /Unsupported/)
  await assert.rejects(assertPublicHttpUrl('http://user:password@example.com/audio'), /Unsupported/)
})

test('trusted cover CDNs can use fake-ip DNS addresses', async () => {
  const lookup = async () => [
    { address: '198.18.1.241', family: 4 },
    { address: 'fdfe:dcba:9876::1d8', family: 6 },
  ]

  await assert.doesNotReject(
    assertPublicHttpUrl('http://i2.hdslb.com/bfs/archive/cover.jpg', {
      allowFakeIpForHosts: ['hdslb.com'],
      lookup,
    }),
  )
})

test('fake-ip DNS addresses remain blocked for untrusted hosts', async () => {
  const lookup = async () => [{ address: '198.18.1.241', family: 4 }]

  await assert.rejects(assertPublicHttpUrl('http://example.com/cover.jpg', { lookup }), /non-public/)
})
