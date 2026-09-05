import assert from 'node:assert/strict'
import test from 'node:test'
import { MediaProcessingError, normalizeMediaCookie, resolveMediaCookie } from './customMediaService.js'

test('normalizes a browser Cookie header into Netscape format', () => {
  const normalized = normalizeMediaCookie('Cookie: SID=secret; PREF=lang%3Den', 'youtube')

  assert.match(normalized, /^# Netscape HTTP Cookie File/m)
  assert.match(normalized, /\.youtube\.com\tTRUE\t\/\tTRUE\t0\tSID\tsecret/)
  assert.match(normalized, /\.youtube\.com\tTRUE\t\/\tTRUE\t0\tPREF\tlang%3Den/)
})

test('preserves an exported Netscape cookie file', () => {
  const cookies = '# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tsecret'
  assert.equal(normalizeMediaCookie(cookies, 'bilibili'), cookies)
})

test('rejects empty or malformed cookie text', () => {
  assert.throws(
    () => normalizeMediaCookie('not a cookie', 'youtube'),
    (error: unknown) => {
      return error instanceof MediaProcessingError && error.code === 'INVALID_COOKIE_FILE'
    },
  )
  assert.throws(() => normalizeMediaCookie('SID=value\twith-tab', 'youtube'), MediaProcessingError)
})

test('room media cookies override environment defaults', () => {
  const environment = resolveMediaCookie(null, 'SID=environment', 'youtube')
  const roomOverride = resolveMediaCookie('SID=room', 'SID=environment', 'youtube')

  assert.match(environment!, /\tSID\tenvironment$/m)
  assert.match(roomOverride!, /\tSID\troom$/m)
  assert.doesNotMatch(roomOverride!, /\tSID\tenvironment$/m)
  assert.equal(resolveMediaCookie(null, null, 'youtube'), null)
})
