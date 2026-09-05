import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoomState, Track } from '@music-together/shared'
import { usePlayerStore } from './playerStore'
import { useRoomStore } from './roomStore'

const track: Track = {
  id: 'track-1',
  title: 'Refresh-safe track',
  artist: ['Artist'],
  album: 'Album',
  duration: 180,
  cover: 'https://example.com/cover.jpg',
  source: 'netease',
  sourceId: 'source-1',
  urlId: 'url-1',
}

const room: RoomState = {
  id: 'room-1',
  name: 'Room',
  creatorId: 'user-1',
  hostId: 'user-1',
  hasPassword: false,
  audioQuality: 999,
  sourcePriority: 'smart',
  hidden: false,
  permanent: false,
  chatHistoryForNewUsers: true,
  users: [],
  currentTrack: track,
  playState: {
    isPlaying: true,
    currentTime: 30,
    serverTimestamp: Date.now(),
    playbackRevision: 1,
  },
  playMode: 'sequential',
  pauseAtQueueEnd: false,
}

test('room track remains authoritative while the audio engine is unloaded or reset', () => {
  useRoomStore.getState().setRoom(room)
  usePlayerStore.getState().reset()

  assert.equal(useRoomStore.getState().room?.currentTrack?.id, track.id)
  assert.equal(usePlayerStore.getState().loadedTrack, null)

  useRoomStore.getState().reset()
})
