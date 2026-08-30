import assert from 'node:assert/strict'
import test from 'node:test'
import { getActiveLineIndices, mergeLrcTextByTime, parseLrcTimeline, toAmllTimeline } from './lyricTimeline.js'

test('multi-timestamp LRC creates one lyric entry per timestamp', () => {
  assert.deepEqual(parseLrcTimeline('[00:10.00][01:05.250]Chorus'), [
    { timeMs: 10_000, text: 'Chorus' },
    { timeMs: 65_250, text: 'Chorus' },
  ])
})

test('equal timestamps share the next strictly later end time', () => {
  const lines = toAmllTimeline([
    { timeMs: 20_000, text: 'Lead' },
    { timeMs: 20_000, text: 'Harmony' },
    { timeMs: 25_000, text: 'Next' },
  ])

  assert.equal(lines[0]?.endTime, 25_000)
  assert.equal(lines[1]?.endTime, 25_000)
})

test('active lines respect end boundaries and overlapping timestamps', () => {
  const lines = toAmllTimeline([
    { timeMs: 20_000, text: 'Lead' },
    { timeMs: 20_000, text: 'Harmony' },
    { timeMs: 25_000, text: 'Next' },
  ])

  assert.deepEqual(getActiveLineIndices(lines, 19_999), [])
  assert.deepEqual(getActiveLineIndices(lines, 20_000), [0, 1])
  assert.deepEqual(getActiveLineIndices(lines, 25_000), [2])
  assert.deepEqual(getActiveLineIndices(lines, 31_000), [])
})

test('duplicate-timestamp translations pair with duplicate original lines in order', () => {
  const targets = [
    { timeMs: 20_000, translation: '' },
    { timeMs: 20_000, translation: '' },
  ]
  mergeLrcTextByTime(
    targets,
    (target) => target.timeMs,
    '[00:20.00]Lead translation\n[00:20.00]Harmony translation',
    (target, text) => {
      target.translation = text
    },
  )
  assert.deepEqual(
    targets.map((target) => target.translation),
    ['Lead translation', 'Harmony translation'],
  )
})
