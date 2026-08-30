import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'

export interface LrcTimelineEntry {
  timeMs: number
  text: string
  translation?: string
}

const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g

export function parseLrcTimeline(lrc: string): LrcTimelineEntry[] {
  const entries: LrcTimelineEntry[] = []
  for (const rawLine of lrc.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(TIMESTAMP_PATTERN)]
    if (timestamps.length === 0) continue
    const text = rawLine.replace(TIMESTAMP_PATTERN, '').trim()
    if (!text) continue
    for (const match of timestamps) {
      const minutes = Number.parseInt(match[1], 10)
      const seconds = Number.parseInt(match[2], 10)
      const milliseconds = match[3] ? Number.parseInt(match[3].padEnd(3, '0'), 10) : 0
      entries.push({ timeMs: (minutes * 60 + seconds) * 1000 + milliseconds, text })
    }
  }
  return entries.sort((a, b) => a.timeMs - b.timeMs)
}

export function toAmllTimeline(entries: LrcTimelineEntry[]): AMLLLyricLine[] {
  const nextLaterTimes = new Array<number | undefined>(entries.length)
  for (let index = 0; index < entries.length; ) {
    const time = entries[index].timeMs
    let end = index + 1
    while (end < entries.length && entries[end].timeMs === time) end += 1
    const nextTime = entries[end]?.timeMs
    for (let groupIndex = index; groupIndex < end; groupIndex += 1) nextLaterTimes[groupIndex] = nextTime
    index = end
  }

  return entries.map((entry, index) => {
    const endTime = nextLaterTimes[index] ?? entry.timeMs + 5_000
    return {
      words: [{ word: entry.text, startTime: entry.timeMs, endTime, romanWord: '', obscene: false }],
      translatedLyric: entry.translation ?? '',
      romanLyric: '',
      startTime: entry.timeMs,
      endTime,
      isBG: false,
      isDuet: false,
    }
  })
}

export function getActiveLineIndices(lines: AMLLLyricLine[], timeMs: number): number[] {
  const result: number[] = []
  lines.forEach((line, index) => {
    if (line.startTime <= timeMs && timeMs < line.endTime) result.push(index)
  })
  return result
}

export function mergeLrcTextByTime<T>(
  targets: T[],
  getTargetTimeMs: (target: T) => number,
  auxiliaryLrc: string,
  setText: (target: T, text: string) => void,
): void {
  const grouped = new Map<number, string[]>()
  for (const entry of parseLrcTimeline(auxiliaryLrc)) {
    const key = Math.round(entry.timeMs / 100)
    const values = grouped.get(key) ?? []
    values.push(entry.text)
    grouped.set(key, values)
  }
  const consumed = new Map<number, number>()

  for (const target of targets) {
    const key = Math.round(getTargetTimeMs(target) / 100)
    let matchedKey: number | undefined
    for (let offset = 0; offset <= 5 && matchedKey === undefined; offset += 1) {
      const candidates = offset === 0 ? [key] : [key + offset, key - offset]
      matchedKey = candidates.find((candidate) => grouped.has(candidate))
    }
    if (matchedKey === undefined) continue
    const values = grouped.get(matchedKey)!
    const index = consumed.get(matchedKey) ?? 0
    setText(target, values[Math.min(index, values.length - 1)])
    consumed.set(matchedKey, index + 1)
  }
}
