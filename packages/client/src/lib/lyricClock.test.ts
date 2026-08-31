import assert from 'node:assert/strict'
import test from 'node:test'
import { getLyricTime, publishLyricTime, subscribeLyricTime } from './lyricClock'

test('publishes rounded playback ticks and explicit seeks', () => {
  const updates: Array<{ timeMs: number; isSeek: boolean }> = []
  const unsubscribe = subscribeLyricTime((update) => updates.push(update))

  publishLyricTime(1234.6)
  publishLyricTime(1234.8)
  publishLyricTime(5000, true)
  unsubscribe()

  assert.deepEqual(updates, [
    { timeMs: 1235, isSeek: false },
    { timeMs: 5000, isSeek: true },
  ])
  assert.deepEqual(getLyricTime(), { timeMs: 5000, isSeek: true })
})

test('an equal playback tick clears the previous seek state', () => {
  const updates: Array<{ timeMs: number; isSeek: boolean }> = []
  const unsubscribe = subscribeLyricTime((update) => updates.push(update))

  publishLyricTime(7000, true)
  publishLyricTime(7000)
  unsubscribe()

  assert.deepEqual(updates, [
    { timeMs: 7000, isSeek: true },
    { timeMs: 7000, isSeek: false },
  ])
  assert.deepEqual(getLyricTime(), { timeMs: 7000, isSeek: false })
})

test('unsubscribe stops clock delivery', () => {
  let calls = 0
  const unsubscribe = subscribeLyricTime(() => {
    calls += 1
  })

  unsubscribe()
  publishLyricTime(6000)

  assert.equal(calls, 0)
})

test('ignores invalid media times and clamps negative seeks', () => {
  const updates: Array<{ timeMs: number; isSeek: boolean }> = []
  const unsubscribe = subscribeLyricTime((update) => updates.push(update))

  publishLyricTime(Number.NaN, true)
  publishLyricTime(-50, true)
  unsubscribe()

  assert.deepEqual(updates, [{ timeMs: 0, isSeek: true }])
})
