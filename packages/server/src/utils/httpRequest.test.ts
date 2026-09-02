import assert from 'node:assert/strict'
import test from 'node:test'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { portForUrl, requestForUrl } from './httpRequest.js'

test('selects the transport and default port from the URL protocol', () => {
  assert.equal(requestForUrl(new URL('http://unm.local')), httpRequest)
  assert.equal(portForUrl(new URL('http://unm.local')), 80)
  assert.equal(requestForUrl(new URL('https://unm.example')), httpsRequest)
  assert.equal(portForUrl(new URL('https://unm.example')), 443)
  assert.equal(portForUrl(new URL('https://unm.example:8443')), 8443)
})
