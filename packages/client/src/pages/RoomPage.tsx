import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { EVENTS, ERROR_CODE } from '@music-together/shared'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { InteractionGate } from '@/components/InteractionGate'
import { AudioPlayer } from '@/components/Player/AudioPlayer'
import { ChatPanel } from '@/components/Chat/ChatPanel'
import { RoomHeader } from '@/components/Room/RoomHeader'
import { SearchDialog } from '@/components/Overlays/SearchDialog'
import { QueueDrawer } from '@/components/Overlays/QueueDrawer'
import { SettingsDialog, type SettingsTab } from '@/components/Overlays/SettingsDialog'
import { PasswordDialog } from '@/components/Lobby/PasswordDialog'
import { cn } from '@/lib/utils'
import { isAudioUnlocked, unlockAudio } from '@/lib/audioUnlock'
import { SERVER_URL } from '@/lib/config'
import { useRoom } from '@/hooks/useRoom'
import { usePlayer } from '@/hooks/usePlayer'
import { useQueue } from '@/hooks/useQueue'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useRoomStore } from '@/stores/roomStore'
import { useChatStore } from '@/stores/chatStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useShortcutStore } from '@/stores/shortcutStore'
import { useAccountStore, type AccountMe } from '@/stores/accountStore'
import { useSocketContext } from '@/providers/SocketProvider'
import { AbilityProvider } from '@/providers/AbilityProvider'
import { useClockSync } from '@/hooks/useClockSync'
import { storage } from '@/lib/storage'

/** Invisible component that runs NTP clock-sync only while in a room. */
function ClockSyncRunner() {
  useClockSync()
  return null
}

interface RoomCheckInfo {
  name: string
  hasPassword: boolean
  userCount: number
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { socket, isConnected } = useSocketContext()
  const { leaveRoom, dissolveRoom, updateSettings, setUserRole } = useRoom()
  const { play, pause, seek, next, prev } = usePlayer()
  const { addTrack, insertAfterCurrent, removeTrack, reorderTracks, clearQueue } = useQueue()

  const room = useRoomStore((s) => s.room)
  const chatOpen = useChatStore((s) => s.isChatOpen)
  const setChatOpen = useChatStore((s) => s.setIsChatOpen)
  const chatUnreadCount = useChatStore((s) => s.unreadCount)
  const toggleChat = useCallback(() => {
    setChatOpen(!useChatStore.getState().isChatOpen)
  }, [setChatOpen])
  const isMobile = useIsMobile()

  // --- Pre-check state ---
  const [checking, setChecking] = useState(true)
  const [roomInfo, setRoomInfo] = useState<RoomCheckInfo | null>(null)

  // Gate: audio must be unlocked before joining the room.
  // From lobby: isAudioUnlocked() is already true → gate skipped, auto-join runs immediately.
  // Direct URL / page refresh: gate blocks until user clicks "开始收听".
  const [gateOpen, setGateOpen] = useState(() => isAudioUnlocked())
  const [gatePasswordError, setGatePasswordError] = useState<string | null>(null)

  const [searchOpen, setSearchOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined)
  const [playerFullscreen, setPlayerFullscreen] = useState(false)
  const [fullscreenSignal, setFullscreenSignal] = useState(0)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  const [mobileChatMetrics, setMobileChatMetrics] = useState({ bottom: 0, height: 0 })

  // Fallback password dialog state (edge case: password changed after pre-check)
  const [passwordNeeded, setPasswordNeeded] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const joiningRef = useRef(false)
  const isLeavingRef = useRef(false)
  const passwordRef = useRef<string | undefined>(undefined)
  const gateNicknameRef = useRef<string | undefined>(undefined)
  const overlayStateRef = useRef({ searchOpen: false, queueOpen: false, settingsOpen: false, chatOpen: false })

  useEffect(() => {
    let cancelled = false
    useAccountStore.getState().setLoading(true)
    fetch(`${SERVER_URL}/api/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AccountMe | null) => {
        if (!cancelled) useAccountStore.getState().setMe(data)
      })
      .catch(() => {
        if (!cancelled) useAccountStore.getState().setMe(null)
      })
      .finally(() => {
        if (!cancelled) useAccountStore.getState().setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // --- Pre-check: fetch room existence & password requirement ---
  useEffect(() => {
    if (!roomId) {
      navigate('/', { replace: true })
      return
    }

    // If already in this room (e.g. navigated from lobby), skip pre-check
    if (room && room.id === roomId) {
      setChecking(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function checkRoom() {
      try {
        const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/check`, {
          signal: controller.signal,
          credentials: 'include',
        })
        if (cancelled) return

        if (!res.ok) {
          // Room not found
          toast.error('房间不存在')
          navigate('/', { replace: true })
          return
        }

        const data = await res.json()
        setRoomInfo({
          name: data.name,
          hasPassword: data.hasPassword,
          userCount: data.userCount,
        })
      } catch (err) {
        if (cancelled) return
        // Network error — still allow the user to try (gate will show, join may fail)
        console.warn('Room pre-check failed:', err)
        setRoomInfo(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    checkRoom()
    return () => {
      cancelled = true
      controller.abort()
    }
    // `room` is excluded intentionally — this effect only runs on mount / roomId change.
    // `navigate` is stable (React Router guarantee) and would cause unnecessary re-runs if included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // --- Gate start handler (receives password from gate if applicable) ---
  const handleGateStart = useCallback(async (password?: string, nickname?: string) => {
    await unlockAudio()
    if (password) passwordRef.current = password
    if (nickname) gateNicknameRef.current = nickname
    setGatePasswordError(null)
    setGateOpen(true)
  }, [])

  // --- Auto-join if room state is missing (e.g. page refresh, direct URL access) ---
  // Only after the interaction gate is open — avoids autoplay warnings.
  useEffect(() => {
    if (!gateOpen) return
    if (isLeavingRef.current) return
    if (!room && isConnected && !joiningRef.current && roomId) {
      joiningRef.current = true
      const nickname = gateNicknameRef.current || storage.getNickname()
      if (!nickname) {
        joiningRef.current = false
        setGateOpen(false) // Re-show InteractionGate so user can set nickname
        return
      }
      socket.emit(EVENTS.ROOM_JOIN, {
        roomId,
        nickname,
        password: passwordRef.current || undefined,
        rejoinToken: storage.getRejoinToken(roomId) ?? undefined,
      })
    }
    if (room) {
      joiningRef.current = false
    }
  }, [gateOpen, room, isConnected, socket, roomId])

  // --- Handle ROOM_ERROR — password errors, fallback dialog ---
  useEffect(() => {
    const onRoomError = (error: { code: string; message: string }) => {
      joiningRef.current = false

      if (error.code === ERROR_CODE.WRONG_PASSWORD) {
        // If we came through the gate, revert to gate with error
        if (!passwordNeeded && !gateOpen) {
          // Gate was not yet open — shouldn't happen, but handle gracefully
          setPasswordNeeded(true)
          return
        }

        if (gateOpen && !passwordNeeded) {
          // Password was sent from gate but rejected (e.g. race condition / password changed)
          // Reset gate so user can re-enter password
          setGateOpen(false)
          setGatePasswordError('密码错误，请重试')
          passwordRef.current = undefined
          return
        }

        // Fallback password dialog path
        if (passwordNeeded) {
          setPasswordError('密码错误，请重试')
          setPasswordLoading(false)
        } else {
          setPasswordNeeded(true)
          setPasswordLoading(false)
        }
      }
    }

    // On successful join, dismiss any password state
    const onRoomState = () => {
      if (passwordNeeded) {
        setPasswordNeeded(false)
        setPasswordError(null)
        setPasswordLoading(false)
      }
      setGatePasswordError(null)
    }

    socket.on(EVENTS.ROOM_ERROR, onRoomError)
    socket.on(EVENTS.ROOM_STATE, onRoomState)
    return () => {
      socket.off(EVENTS.ROOM_ERROR, onRoomError)
      socket.off(EVENTS.ROOM_STATE, onRoomState)
    }
  }, [socket, passwordNeeded, gateOpen])

  // No unmount cleanup needed — the server handles room membership:
  // - On disconnect: server's disconnect handler removes user
  // - On join/create another room: server auto-leaves old room
  // - On explicit leave: user clicks the leave button below

  const handlePasswordSubmit = useCallback(
    (password: string) => {
      if (!roomId) return
      const nickname = storage.getNickname()
      if (!nickname) return
      setPasswordLoading(true)
      setPasswordError(null)
      socket.emit(EVENTS.ROOM_JOIN, {
        roomId,
        nickname,
        password,
        rejoinToken: storage.getRejoinToken(roomId) ?? undefined,
      })
    },
    [socket, roomId],
  )

  // If password dialog is dismissed without submitting, navigate home
  const handlePasswordOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setPasswordNeeded(false)
        setPasswordError(null)
        navigate('/', { replace: true })
      }
    },
    [navigate],
  )

  const handleOpenMembers = useCallback(() => {
    setSettingsInitialTab('members')
    setSettingsOpen(true)
  }, [])

  const handleLeaveRoom = useCallback(() => {
    isLeavingRef.current = true
    leaveRoom()
    navigate('/', { replace: true })
  }, [leaveRoom, navigate])

  useEffect(() => {
    if (playerFullscreen) setChatOpen(false)
  }, [playerFullscreen, setChatOpen])

  useEffect(() => {
    if (!isMobile || !chatOpen || typeof window === 'undefined') return

    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'

    const updateMobileChatMetrics = () => {
      const viewport = window.visualViewport
      const layoutHeight = window.innerHeight
      const visibleHeight = viewport?.height ?? layoutHeight
      const verticalGap = 8
      const minHeight = Math.min(360, Math.max(280, visibleHeight - verticalGap * 2))
      const preferredHeight = visibleHeight * 0.72
      const maxHeight = Math.max(minHeight, visibleHeight - verticalGap * 2)
      setMobileChatMetrics({
        bottom: 0,
        height: Math.round(Math.min(Math.max(preferredHeight, minHeight), maxHeight)),
      })
    }

    updateMobileChatMetrics()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', updateMobileChatMetrics)
    viewport?.addEventListener('scroll', updateMobileChatMetrics)
    window.addEventListener('resize', updateMobileChatMetrics)

    return () => {
      viewport?.removeEventListener('resize', updateMobileChatMetrics)
      viewport?.removeEventListener('scroll', updateMobileChatMetrics)
      window.removeEventListener('resize', updateMobileChatMetrics)
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll
    }
  }, [chatOpen, isMobile])

  useEffect(() => {
    overlayStateRef.current = { searchOpen, queueOpen, settingsOpen, chatOpen }
  }, [chatOpen, queueOpen, searchOpen, settingsOpen])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const tagName = target.tagName.toLowerCase()
      return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return

      const action = useShortcutStore.getState().findAction(event.key)
      if (!action) return

      event.preventDefault()
      switch (action) {
        case 'playPause':
          usePlayerStore.getState().isPlaying ? pause() : play()
          break
        case 'chat':
          toggleChat()
          break
        case 'next':
          next()
          break
        case 'prev':
          prev()
          break
        case 'search':
          setSearchOpen(true)
          setSearchFocusSignal((value) => value + 1)
          break
        case 'fullscreen':
          setChatOpen(false)
          setFullscreenSignal((value) => value + 1)
          break
        case 'queue':
          setQueueOpen((open) => !open)
          break
        case 'escape':
          {
            event.stopImmediatePropagation()
            const state = overlayStateRef.current
            if (state.searchOpen) setSearchOpen(false)
            else if (state.queueOpen) setQueueOpen(false)
            else if (state.settingsOpen) setSettingsOpen(false)
            else if (state.chatOpen) setChatOpen(false)
            else setSettingsOpen(true)
          }
          break
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [chatOpen, next, pause, play, prev, queueOpen, searchOpen, setChatOpen, settingsOpen, toggleChat])

  // --- Loading state during pre-check ---
  if (checking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在检查房间...</p>
        </motion.div>
      </div>
    )
  }

  // --- Interaction gate (audio unlock + optional password) ---
  if (!gateOpen) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <InteractionGate
          onStart={handleGateStart}
          roomName={roomInfo?.name}
          hasPassword={roomInfo?.hasPassword || !!gatePasswordError}
          passwordError={gatePasswordError}
        />
      </motion.div>
    )
  }

  return (
    <AbilityProvider>
      <ClockSyncRunner />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex h-dvh flex-col bg-background">
          <RoomHeader
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenMembers={handleOpenMembers}
            onLeaveRoom={handleLeaveRoom}
          />

          <div className="flex min-h-0 flex-1 overflow-hidden p-2 md:p-3 lg:p-4">
            <div className="min-w-0 flex-1 overflow-hidden rounded-2xl">
              <AudioPlayer
                onPlay={play}
                onPause={pause}
                onSeek={seek}
                onNext={next}
                onPrev={prev}
                onOpenChat={toggleChat}
                onOpenQueue={() => setQueueOpen(true)}
                chatUnreadCount={chatUnreadCount}
                onFullscreenChange={setPlayerFullscreen}
                fullscreenSignal={fullscreenSignal}
              />
            </div>

            {/* Desktop: inline chat panel that squeezes the player */}
            <div
              className={cn(
                'hidden h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out md:block',
                chatOpen && !playerFullscreen ? 'w-[320px] pl-3' : 'w-0',
              )}
            >
              <div className="flex h-full w-[320px] flex-col">{chatOpen && <ChatPanel />}</div>
            </div>
          </div>

          {!isMobile && playerFullscreen && chatOpen && (
            <div className="fixed right-4 top-4 bottom-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-2xl backdrop-blur">
              <ChatPanel />
            </div>
          )}

          {/* Mobile: fixed chat sheet. Avoid Vaul input repositioning fighting the soft keyboard. */}
          <AnimatePresence>
            {isMobile && chatOpen && (
              <motion.div
                className="fixed inset-0 z-50 md:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="聊天"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
              >
                <motion.button
                  type="button"
                  className="absolute inset-0 bg-black/50"
                  aria-label="关闭聊天"
                  onClick={() => setChatOpen(false)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                />
                <motion.div
                  className="fixed inset-x-0 flex max-w-[100dvw] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-2xl will-change-transform"
                  style={{
                    bottom: mobileChatMetrics.bottom,
                    height: mobileChatMetrics.height || 'min(72dvh, calc(100dvh - 4rem))',
                  }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
                >
                  <div className="mx-auto mt-3 h-1.5 w-20 shrink-0 rounded-full bg-muted" />
                  <div className="min-h-0 flex-1">
                    <ChatPanel className="border-l-0" />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <SearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onAddToQueue={addTrack}
            onInsertAfterCurrent={insertAfterCurrent}
            focusSignal={searchFocusSignal}
          />
          <QueueDrawer
            open={queueOpen}
            onOpenChange={setQueueOpen}
            onRemoveFromQueue={removeTrack}
            onReorderQueue={reorderTracks}
            onClearQueue={clearQueue}
          />
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={(open) => {
              setSettingsOpen(open)
              if (!open) setSettingsInitialTab(undefined)
            }}
            onUpdateSettings={updateSettings}
            onDissolveRoom={dissolveRoom}
            onSetUserRole={setUserRole}
            initialTab={settingsInitialTab}
          />
        </div>

        {/* Fallback password dialog for edge cases (password changed after pre-check) */}
        <PasswordDialog
          open={passwordNeeded}
          onOpenChange={handlePasswordOpenChange}
          roomName={room?.name ?? roomId ?? ''}
          onSubmit={handlePasswordSubmit}
          error={passwordError}
          isLoading={passwordLoading}
        />
      </motion.div>
    </AbilityProvider>
  )
}
