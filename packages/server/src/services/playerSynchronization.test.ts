import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '@music-together/shared'
import type { TypedServer } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { userRepo } from '../repositories/userRepository.js'
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
