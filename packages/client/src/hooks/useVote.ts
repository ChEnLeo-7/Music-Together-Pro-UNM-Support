import { useCallback, useEffect, useState } from 'react'
import { EVENTS } from '@music-together/shared'
import type { PlayMode, VoteAction, VoteState } from '@music-together/shared'
import { useSocketContext } from '@/providers/SocketProvider'
import { useSocketEvent } from './useSocketEvent'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

const ACTION_KEYS = {
  pause: 'votePause', resume: 'voteResume', next: 'voteNext', prev: 'votePrev',
  'set-mode': 'voteSetMode', 'play-track': 'votePlay', 'remove-track': 'voteRemove',
} as const

const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  sequential: '顺序播放',
  'loop-all': '列表循环',
  'loop-one': '单曲循环',
  shuffle: '随机播放',
}

/** Get a human-readable label for a vote action, including payload context */
export function getVoteActionLabel(action: VoteAction, payload?: Record<string, unknown>): string {
  const t = useI18n.getState().t
  if (action === 'set-mode' && payload?.mode) {
    const modeLabel = PLAY_MODE_LABELS[payload.mode as PlayMode] ?? payload.mode
    return `${t('voteSetMode')}: ${modeLabel}`
  }
  if (action === 'play-track' && payload?.trackTitle) {
    return `${t('votePlay')}: ${payload.trackTitle}`
  }
  if (action === 'remove-track' && payload?.trackTitle) {
    return `${t('voteRemove')}: ${payload.trackTitle}`
  }
  return t(ACTION_KEYS[action])
}

export function useVote() {
  const { socket } = useSocketContext()
  const [activeVote, setActiveVote] = useState<VoteState | null>(null)
  const t = useI18n((s) => s.t)

  useSocketEvent(
    EVENTS.VOTE_STARTED,
    useCallback((vote: VoteState) => {
      setActiveVote(vote)
    }, []),
  )

  useSocketEvent(
    EVENTS.VOTE_RESULT,
    useCallback((data: { passed: boolean; action: VoteAction; reason?: string }) => {
      setActiveVote(null)
       const label = getVoteActionLabel(data.action)
      if (data.passed) {
         toast.success(t('votePassed', { action: label }))
      } else {
        const reasonText = data.reason === 'host_veto' ? t('voteHostVeto') : data.reason === 'timeout' ? t('voteTimeout') : ''
         toast.error(t('voteRejected', { action: label, reason: reasonText }))
      }
     }, [t]),
  )

  // Clear active vote on disconnect
  useEffect(() => {
    const onDisconnect = () => setActiveVote(null)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('disconnect', onDisconnect)
    }
  }, [socket])

  const startVote = useCallback(
    (action: VoteAction, payload?: Record<string, unknown>) => {
      socket.emit(EVENTS.VOTE_START, { action, payload })
       toast.info(t('voteStarted', { action: getVoteActionLabel(action, payload) }))
    },
     [socket, t],
  )

  const castVote = useCallback(
    (approve: boolean) => {
      socket.emit(EVENTS.VOTE_CAST, { approve })
    },
    [socket],
  )

  return { activeVote, startVote, castVote }
}
