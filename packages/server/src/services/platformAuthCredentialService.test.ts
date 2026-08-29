import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decryptPlatformCredential, encryptPlatformCredential } from './platformAuthCredentialService.js'

test('platform credentials are authenticated ciphertext at rest', () => {
  const cookie = 'MUSIC_U=sensitive-cookie-value'
  const encrypted = encryptPlatformCredential(cookie)

  assert.notEqual(encrypted, cookie)
  assert.equal(encrypted.includes(cookie), false)
  assert.equal(decryptPlatformCredential(encrypted), cookie)
})
