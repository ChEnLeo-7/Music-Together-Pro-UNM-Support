import assert from 'node:assert/strict'
import test from 'node:test'
import { projectPlaybackPosition } from './playbackPosition'

test('paused playback remains at its exact anchored position', () => {
  assert.equal(projectPlaybackPosition({ currentTime: 42, serverTimestamp: 1_000, isPlaying: false }, 11_000), 42)
})

test('playing playback advances from server time and clamps to duration', () => {
  assert.equal(projectPlaybackPosition({ currentTime: 30, serverTimestamp: 1_000, isPlaying: true }, 6_000), 35)
  assert.equal(
    projectPlaybackPosition({ currentTime: 238, serverTimestamp: 1_000, isPlaying: true, duration: 240 }, 6_000),
    240,
  )
})

test('future anchors and invalid positions never move backward or below zero', () => {
  assert.equal(projectPlaybackPosition({ currentTime: 12, serverTimestamp: 5_000, isPlaying: true }, 1_000), 12)
  assert.equal(projectPlaybackPosition({ currentTime: Number.NaN, serverTimestamp: 0, isPlaying: false }, 0), 0)
})
