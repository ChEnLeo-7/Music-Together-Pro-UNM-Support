import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { userRepo } from '../repositories/userRepository.js'
import { persistentRoomRepo } from '../repositories/persistentRoomRepository.js'
import * as playerService from './playerService.js'
import * as roomService from './roomService.js'

let sequence = 0

function createTrack(id: string): Track {
  return {
    id,
    title: id,
    artist: ['Artist'],
    album: 'Album',
    duration: 240,
    cover: '',
    source: 'netease',
    sourceId: id,
    urlId: id,
    streamUrl: `https://example.com/${id}.mp3`,
  }
}

function fakeIo(): TypedServer {
  const target = { emit: () => target }
  return { to: () => target } as unknown as TypedServer
}

function recordingSocket() {
  const events: Array<{ event: string; payload: unknown }> = []
  return {
    events,
    socket: { emit: (event: string, payload: unknown) => events.push({ event, payload }) } as unknown as TypedSocket,
  }
}

function createTestRoom() {
  sequence += 1
  const userId = `sync-user-${sequence}`
  const webSocketId = `sync-web-${sequence}`
  userRepo.create({ id: userId, kind: 'guest', username: null, nickname: userId, passwordHash: null })
  const created = roomService.createRoom(webSocketId, userId, `Sync ${sequence}`, undefined, userId, true)
  return { ...created, userId, webSocketId }
}

test('a playback-capable socket takes and releases the conductor lease', () => {
  const { room, userId, webSocketId } = createTestRoom()
  const nativeSocketId = `sync-native-${sequence}`

  try {
    assert.equal(room.conductorSocketId, webSocketId)

    roomService.joinRoom(nativeSocketId, room.id, userId, userId, true)
    assert.equal(room.conductorSocketId, nativeSocketId)

    const result = roomService.leaveRoom(nativeSocketId)
    assert.equal(result?.staleSocketOnly, true)
    assert.equal(room.conductorSocketId, webSocketId)
  } finally {
    roomRepo.deleteSocketMapping(nativeSocketId)
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('resume is idempotent and playback commands are serialized by revision', async () => {
  const { room, webSocketId } = createTestRoom()
  const io = fakeIo()
  const track = createTrack(`track-${sequence}`)
  room.queue = [track]
  room.currentTrack = track
  room.playState = { isPlaying: false, currentTime: 42, serverTimestamp: Date.now(), playbackRevision: 0 }

  try {
    await playerService.resumeTrack(io, room.id)
    await playerService.resumeTrack(io, room.id)
    assert.equal(room.playState.isPlaying, true)
    assert.equal(room.playState.playbackRevision, 1)

    await Promise.all([playerService.playTrackInRoom(io, room.id, track), playerService.pauseTrack(io, room.id)])
    assert.equal(room.playState.isPlaying, false)
    assert.equal(room.playState.playbackRevision, 3)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('ready playback instances release the prepare barrier before timeout', async () => {
  const { room, webSocketId } = createTestRoom()
  const io = fakeIo()
  const track = createTrack(`ready-track-${sequence}`)
  room.queue = [track]
  const revision = room.playState.playbackRevision + 1

  try {
    const startedAt = Date.now()
    const playPromise = playerService.playTrackInRoom(io, room.id, track)
    setTimeout(() => playerService.markPlaybackReady(room.id, webSocketId, track.id, revision), 10)
    await playPromise

    assert.ok(Date.now() - startedAt < 500)
    assert.equal(room.playState.playbackRevision, revision)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('reload recovery preserves a sole user paused state and revision', async () => {
  const { room, webSocketId } = createTestRoom()
  const track = createTrack(`paused-track-${sequence}`)
  const { socket, events } = recordingSocket()
  room.currentTrack = track
  room.queue = [track]
  room.playState = { isPlaying: false, currentTime: 42, serverTimestamp: Date.now(), playbackRevision: 7 }

  try {
    await playerService.syncPlaybackToSocket(fakeIo(), socket, room.id, room)
    assert.equal(room.playState.isPlaying, false)
    assert.equal(room.playState.currentTime, 42)
    assert.equal(room.playState.playbackRevision, 7)
    const recovery = events.find(({ event }) => event === 'player:play')?.payload as {
      recovery: boolean
      playState: { isPlaying: boolean; currentTime: number; playbackRevision: number }
    }
    assert.equal(recovery.recovery, true)
    assert.equal(recovery.playState.isPlaying, false)
    assert.equal(recovery.playState.currentTime, 42)
    assert.equal(recovery.playState.playbackRevision, 7)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('pause-at-queue-end keeps the final track loaded', async () => {
  const { room, webSocketId } = createTestRoom()
  const track = createTrack(`final-track-${sequence}`)
  room.queue = [track]
  room.currentTrack = track
  room.pauseAtQueueEnd = true
  room.playState = { isPlaying: true, currentTime: 239, serverTimestamp: Date.now(), playbackRevision: 0 }

  try {
    await playerService.playNextTrackInRoom(fakeIo(), room.id, 'loop-all', {
      pauseAtQueueEnd: true,
      skipDebounce: true,
    })

    assert.equal(room.currentTrack?.id, track.id)
    assert.equal(room.playState.isPlaying, false)
    assert.equal(room.playState.currentTime, track.duration)

    await playerService.resumeTrack(fakeIo(), room.id)
    assert.equal(room.playState.isPlaying, true)
    assert.equal(room.playState.currentTime, 0)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('server advances after track end without a conductor callback', async () => {
  const { room, webSocketId } = createTestRoom()
  const io = fakeIo()
  const firstTrack = createTrack(`watchdog-first-${sequence}`)
  const secondTrack = createTrack(`watchdog-second-${sequence}`)
  room.queue = [firstTrack, secondTrack]
  room.currentTrack = firstTrack
  room.playMode = 'sequential'
  room.playState = {
    isPlaying: true,
    currentTime: firstTrack.duration,
    serverTimestamp: Date.now(),
    playbackRevision: 5,
  }

  try {
    const advancePromise = playerService.reconcileTrackEnd(io, room.id, firstTrack.id, 5)
    setTimeout(() => playerService.markPlaybackReady(room.id, webSocketId, secondTrack.id, 6), 10)
    await advancePromise

    assert.equal(room.currentTrack?.id, secondTrack.id)
    assert.equal(room.playState.isPlaying, true)
    assert.equal(room.playState.playbackRevision, 6)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('track-end reconciliation ignores a stale playback revision', async () => {
  const { room, webSocketId } = createTestRoom()
  const track = createTrack(`watchdog-stale-${sequence}`)
  room.queue = [track]
  room.currentTrack = track
  room.playState = {
    isPlaying: true,
    currentTime: track.duration,
    serverTimestamp: Date.now(),
    playbackRevision: 9,
  }

  try {
    await playerService.reconcileTrackEnd(fakeIo(), room.id, track.id, 8)

    assert.equal(room.currentTrack?.id, track.id)
    assert.equal(room.playState.isPlaying, true)
    assert.equal(room.playState.playbackRevision, 9)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('authoritative watchdog deadline advances despite a stale conductor anchor', async () => {
  const { room, webSocketId } = createTestRoom()
  const io = fakeIo()
  const firstTrack = createTrack(`deadline-first-${sequence}`)
  const secondTrack = createTrack(`deadline-second-${sequence}`)
  room.queue = [firstTrack, secondTrack]
  room.currentTrack = firstTrack
  room.playMode = 'sequential'
  room.playState = {
    isPlaying: true,
    currentTime: 10,
    serverTimestamp: Date.now(),
    playbackRevision: 11,
  }

  try {
    const advancePromise = playerService.reconcileTrackEnd(io, room.id, firstTrack.id, 11, Date.now() - 1)
    setTimeout(() => playerService.markPlaybackReady(room.id, webSocketId, secondTrack.id, 12), 10)
    await advancePromise

    assert.equal(room.currentTrack?.id, secondTrack.id)
    assert.equal(room.playState.playbackRevision, 12)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('watchdog delay safely chunks durations beyond the Node timeout limit', () => {
  assert.equal(playerService.getTrackEndWatchdogDelay(Number.MAX_SAFE_INTEGER), 2_147_000_000)
  assert.equal(playerService.getTrackEndWatchdogDelay(5_000), 7_000)
})

test('automatic removal keeps the next track in loop-all order', async () => {
  const { room, webSocketId } = createTestRoom()
  const firstTrack = createTrack(`remove-first-${sequence}`)
  const currentTrack = createTrack(`remove-current-${sequence}`)
  const nextTrack = createTrack(`remove-next-${sequence}`)
  room.queue = [firstTrack, currentTrack, nextTrack]
  room.currentTrack = currentTrack
  room.playMode = 'loop-all'
  room.removePlayedTracks = true
  room.playState = {
    isPlaying: true,
    currentTime: currentTrack.duration,
    serverTimestamp: Date.now(),
    playbackRevision: 3,
  }

  try {
    await playerService.playNextTrackInRoom(fakeIo(), room.id, room.playMode, {
      skipDebounce: true,
      removePlayedTrack: true,
    })

    assert.deepEqual(
      room.queue.map((track) => track.id),
      [firstTrack.id, nextTrack.id],
    )
    assert.equal(room.currentTrack?.id, nextTrack.id)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('track-end watchdog removes the completed track when the room setting is enabled', async () => {
  const { room, webSocketId } = createTestRoom()
  const completedTrack = createTrack(`watchdog-remove-completed-${sequence}`)
  const nextTrack = createTrack(`watchdog-remove-next-${sequence}`)
  room.queue = [completedTrack, nextTrack]
  room.currentTrack = completedTrack
  room.playMode = 'sequential'
  room.removePlayedTracks = true
  room.playState = {
    isPlaying: true,
    currentTime: completedTrack.duration,
    serverTimestamp: Date.now(),
    playbackRevision: 14,
  }

  try {
    const transition = playerService.reconcileTrackEnd(fakeIo(), room.id, completedTrack.id, 14)
    setTimeout(() => playerService.markPlaybackReady(room.id, webSocketId, nextTrack.id, 15), 10)
    await transition

    assert.deepEqual(
      room.queue.map((track) => track.id),
      [nextTrack.id],
    )
    assert.equal(room.currentTrack?.id, nextTrack.id)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('automatic removal stops playback after the only track finishes', async () => {
  const { room, webSocketId } = createTestRoom()
  const track = createTrack(`remove-only-${sequence}`)
  room.queue = [track]
  room.currentTrack = track
  room.playMode = 'sequential'
  room.removePlayedTracks = true
  room.playState = { isPlaying: true, currentTime: track.duration, serverTimestamp: Date.now(), playbackRevision: 3 }

  try {
    await playerService.playNextTrackInRoom(fakeIo(), room.id, room.playMode, {
      skipDebounce: true,
      removePlayedTrack: true,
    })

    assert.deepEqual(room.queue, [])
    assert.equal(room.currentTrack, null)
    assert.equal(room.playState.isPlaying, false)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('automatic removal ignores a stale natural-end transition', async () => {
  const { room, webSocketId } = createTestRoom()
  const currentTrack = createTrack(`remove-stale-current-${sequence}`)
  const nextTrack = createTrack(`remove-stale-next-${sequence}`)
  room.queue = [currentTrack, nextTrack]
  room.currentTrack = currentTrack
  room.playMode = 'sequential'
  room.removePlayedTracks = true
  room.playState = {
    isPlaying: true,
    currentTime: currentTrack.duration,
    serverTimestamp: Date.now(),
    playbackRevision: 4,
  }

  try {
    await playerService.playNextTrackInRoom(fakeIo(), room.id, room.playMode, {
      skipDebounce: true,
      removePlayedTrack: true,
      expectedCurrentTrackId: 'a-different-track',
      expectedPlaybackRevision: 4,
    })

    assert.deepEqual(
      room.queue.map((track) => track.id),
      [currentTrack.id, nextTrack.id],
    )
    assert.equal(room.currentTrack?.id, currentTrack.id)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('automatic removal stops when the replacement track cannot be prepared', async () => {
  const { room, webSocketId } = createTestRoom()
  const currentTrack = createTrack(`remove-failed-current-${sequence}`)
  const invalidTrack = { ...createTrack(`remove-failed-next-${sequence}`), source: 'custom' as const }
  room.queue = [currentTrack, invalidTrack]
  room.currentTrack = currentTrack
  room.playMode = 'sequential'
  room.removePlayedTracks = true
  room.playState = {
    isPlaying: true,
    currentTime: currentTrack.duration,
    serverTimestamp: Date.now(),
    playbackRevision: 4,
  }

  try {
    await playerService.playNextTrackInRoom(fakeIo(), room.id, room.playMode, {
      skipDebounce: true,
      removePlayedTrack: true,
    })

    assert.deepEqual(room.queue, [])
    assert.equal(room.currentTrack, null)
    assert.equal(room.playState.isPlaying, false)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('automatic removal is not applied to a non-ended next transition', async () => {
  const { room, webSocketId } = createTestRoom()
  const currentTrack = createTrack(`remove-disabled-current-${sequence}`)
  const nextTrack = createTrack(`remove-disabled-next-${sequence}`)
  room.queue = [currentTrack, nextTrack]
  room.currentTrack = currentTrack
  room.playMode = 'sequential'
  room.removePlayedTracks = true
  room.playState = { isPlaying: true, currentTime: 20, serverTimestamp: Date.now(), playbackRevision: 4 }

  try {
    await playerService.playNextTrackInRoom(fakeIo(), room.id, room.playMode, {
      skipDebounce: true,
      removePlayedTrack: false,
    })

    assert.deepEqual(
      room.queue.map((track) => track.id),
      [currentTrack.id, nextTrack.id],
    )
    assert.equal(room.currentTrack?.id, nextTrack.id)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})

test('automatic removal setting is restored for permanent rooms', () => {
  const { room, webSocketId } = createTestRoom()

  try {
    roomService.updateSettings(room.id, { permanent: true, removePlayedTracks: true })

    const restored = persistentRoomRepo.loadPermanentRooms().find((candidate) => candidate.id === room.id)
    assert.equal(restored?.removePlayedTracks, true)
  } finally {
    roomRepo.deleteSocketMapping(webSocketId)
    roomRepo.delete(room.id)
    playerService.cleanupRoom(room.id)
  }
})
