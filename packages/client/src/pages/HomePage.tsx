import { ActionCards } from '@/components/Lobby/ActionCards'
import { CreateRoomDialog } from '@/components/Lobby/CreateRoomDialog'
import { HeroSection } from '@/components/Lobby/HeroSection'
import { IdentityJoinDialog } from '@/components/Lobby/IdentityJoinDialog'
import { PasswordDialog } from '@/components/Lobby/PasswordDialog'
import { RoomListSection } from '@/components/Lobby/RoomListSection'
import { UserPopover } from '@/components/Lobby/UserPopover'
import { Separator } from '@/components/ui/separator'
import { useLobby } from '@/hooks/useLobby'
import { unlockAudio } from '@/lib/audioUnlock'
import { ACTION_LOADING_TIMEOUT_MS } from '@/lib/constants'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/SocketProvider'
import { useRoomStore } from '@/stores/roomStore'
import { useChatStore } from '@/stores/chatStore'
import { useAccountStore } from '@/stores/accountStore'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { EVENTS, ERROR_CODE, type RoomListItem, type RoomState } from '@music-together/shared'
import { Github, Headphones } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

export default function HomePage() {
  const navigate = useNavigate()
  const { socket } = useSocketContext()
  const { rooms, isLoading, createRoom, joinRoom } = useLobby()
  const hasUpdate = useVersionCheck()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState<{ open: boolean; room: RoomListItem | null }>({
    open: false,
    room: null,
  })
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const actionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [directRoomId, setDirectRoomId] = useState('')
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false)

  // Stores the pending join action while waiting for nickname input
  const pendingJoinRef = useRef<{ type: 'room'; room: RoomListItem } | { type: 'direct'; roomId: string } | null>(null)

  // Refs for onError closure to always read the latest values
  const passwordDialogRef = useRef(passwordDialog)
  passwordDialogRef.current = passwordDialog
  const directRoomIdRef = useRef(directRoomId)
  directRoomIdRef.current = directRoomId
  const lastJoinedRoomIdRef = useRef('')
  const pendingNavigationRoomIdRef = useRef<string | null>(null)
  const actionLoadingRef = useRef(actionLoading)
  actionLoadingRef.current = actionLoading

  const setRoom = useRoomStore((s) => s.setRoom)
  const accountMe = useAccountStore((s) => s.me)
  const savedNickname = storage.getNickname()
  const effectiveNickname = accountMe?.nickname || savedNickname

  // Safety timeout: reset actionLoading after 15s to prevent stuck button
  useEffect(() => {
    if (actionLoading) {
      actionTimeoutRef.current = setTimeout(() => {
        setActionLoading(false)
        toast.error('操作超时，请重试')
      }, ACTION_LOADING_TIMEOUT_MS)
    } else {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current)
        actionTimeoutRef.current = null
      }
    }
    return () => {
      if (actionTimeoutRef.current) {
        clearTimeout(actionTimeoutRef.current)
        actionTimeoutRef.current = null
      }
    }
  }, [actionLoading])

  // Listen for room created / room state / chat history events for navigation
  useEffect(() => {
    const onCreated = (data: { roomId: string; userId: string }) => {
      // currentUser will be auto-derived when onState fires and calls setRoom
      pendingNavigationRoomIdRef.current = data.roomId
      setCreateDialogOpen(false)
      // Navigation is handled by onState which fires right after onCreated
    }

    const onState = (roomState: RoomState) => {
      const pendingRoomId = pendingNavigationRoomIdRef.current
      if (pendingRoomId && pendingRoomId !== roomState.id) {
        return
      }
      if (!pendingRoomId && !actionLoadingRef.current) {
        return
      }
      pendingNavigationRoomIdRef.current = null
      // setRoom automatically derives currentUser from room.users
      setRoom(roomState)
      if ('password' in roomState) {
        useRoomStore.getState().setRoomPassword(roomState.password ?? null)
      }
      setActionLoading(false)
      setPasswordDialog({ open: false, room: null })
      setPasswordError(null)
      navigate(`/room/${roomState.id}`)
    }

    const onRejoinToken = (data: { roomId: string; token: string; expiresAt: number }) => {
      storage.setRejoinToken(data.roomId, data.token, data.expiresAt)
    }

    // 服务端在 ROOM_JOIN 后同时 emit ROOM_STATE + CHAT_HISTORY，
    // 若不在这里监听 CHAT_HISTORY，消息会在 navigate 之前丢失
    // （RoomPage 的 useChatSync 尚未挂载）。
    const onChatHistory = (messages: import('@music-together/shared').ChatMessage[]) => {
      useChatStore.getState().setMessages(messages)
    }

    const onError = (error: { code: string; message: string }) => {
      setActionLoading(false)
      if (error.code === ERROR_CODE.WRONG_PASSWORD) {
        // If password dialog is already open, show error
        if (passwordDialogRef.current.open) {
          setPasswordError('密码错误，请重试')
        } else {
          // Direct join hit a password-protected room — open password dialog
          const targetRoomId = lastJoinedRoomIdRef.current || directRoomIdRef.current.trim()
          if (targetRoomId) {
            setPasswordDialog({
              open: true,
              room: {
                id: targetRoomId,
                name: targetRoomId,
                hasPassword: true,
                hidden: false,
                permanent: false,
                userCount: 0,
                currentTrackTitle: null,
                currentTrackArtist: null,
              },
            })
            setPasswordError(null)
          } else {
            toast.error(error.message)
          }
        }
      } else {
        toast.error(error.message)
      }
    }

    socket.on(EVENTS.ROOM_CREATED, onCreated)
    socket.on(EVENTS.ROOM_STATE, onState)
    socket.on(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
    socket.on(EVENTS.CHAT_HISTORY, onChatHistory)
    socket.on(EVENTS.ROOM_ERROR, onError)

    return () => {
      socket.off(EVENTS.ROOM_CREATED, onCreated)
      socket.off(EVENTS.ROOM_STATE, onState)
      socket.off(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
      socket.off(EVENTS.CHAT_HISTORY, onChatHistory)
      socket.off(EVENTS.ROOM_ERROR, onError)
    }
  }, [socket, navigate, setRoom])

  const handleCreateRoom = async (nickname: string, roomName?: string, password?: string) => {
    await unlockAudio()
    storage.setNickname(nickname)
    pendingNavigationRoomIdRef.current = null
    setActionLoading(true)
    createRoom(nickname, roomName, password)
  }

  const handleRoomClick = async (room: RoomListItem) => {
    if (actionLoading) return
    if (!effectiveNickname) {
      pendingJoinRef.current = { type: 'room', room }
      setIdentityDialogOpen(true)
      return
    }

    await unlockAudio()

    if (room.hasPassword) {
      setPasswordDialog({ open: true, room })
      setPasswordError(null)
    } else {
      pendingNavigationRoomIdRef.current = room.id
      setActionLoading(true)
      joinRoom(room.id, effectiveNickname)
    }
  }

  const handlePasswordSubmit = (password: string) => {
    if (!passwordDialog.room) return
    if (!effectiveNickname) return
    pendingNavigationRoomIdRef.current = passwordDialog.room.id
    setActionLoading(true)
    setPasswordError(null)
    joinRoom(passwordDialog.room.id, effectiveNickname, password)
  }

  const handleDirectJoin = async () => {
    if (actionLoading) return
    if (!directRoomId.trim()) {
      toast.error('请输入房间号')
      return
    }
    if (!effectiveNickname) {
      pendingJoinRef.current = { type: 'direct', roomId: directRoomId.trim() }
      setIdentityDialogOpen(true)
      return
    }
    await unlockAudio()
    lastJoinedRoomIdRef.current = directRoomId.trim()
    pendingNavigationRoomIdRef.current = directRoomId.trim()
    setActionLoading(true)
    joinRoom(directRoomId.trim(), effectiveNickname)
  }

  /** Called after the user selects account login or guest access. */
  const handleIdentityConfirm = useCallback(
    async (nickname: string) => {
      setIdentityDialogOpen(false)
      const pending = pendingJoinRef.current
      pendingJoinRef.current = null
      if (!pending) return

      await unlockAudio()

      if (pending.type === 'room') {
        const room = pending.room
        if (room.hasPassword) {
          setPasswordDialog({ open: true, room })
          setPasswordError(null)
        } else {
          pendingNavigationRoomIdRef.current = room.id
          setActionLoading(true)
          joinRoom(room.id, nickname)
        }
      } else {
        lastJoinedRoomIdRef.current = pending.roomId
        pendingNavigationRoomIdRef.current = pending.roomId
        setActionLoading(true)
        joinRoom(pending.roomId, nickname)
      }
    },
    [joinRoom],
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex min-h-screen flex-col bg-background"
    >
      {/* Header */}
      <header className="border-b border-border/50 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Headphones className="h-5 w-5 text-primary" />
            <span className="text-base font-semibold tracking-tight text-foreground">Music Together</span>
          </div>
          <UserPopover />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <HeroSection />

          <ActionCards
            directRoomId={directRoomId}
            onDirectRoomIdChange={setDirectRoomId}
            onCreateClick={() => setCreateDialogOpen(true)}
            onDirectJoin={handleDirectJoin}
            actionLoading={actionLoading}
          />

          <Separator className="mb-8" />

          <RoomListSection rooms={rooms} isLoading={isLoading} onRoomClick={handleRoomClick} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4">
          <span className="text-xs text-muted-foreground">
            Music-Together-unm-support · Made by CHENLEO_7 ·{' '}
            <a
              href="https://github.com/ChEnLeo-7/Music-Together-unm-support/blob/main/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="relative inline-flex items-center transition-colors hover:text-foreground"
            >
              v{__APP_VERSION__}
              {hasUpdate && (
                <span
                  className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-red-500"
                  title="有新版本可用，刷新页面以更新"
                />
              )}
            </a>
          </span>
          <a
            href="https://github.com/ChEnLeo-7/Music-Together-unm-support"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </footer>

      {/* Dialogs */}
      <CreateRoomDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateRoom={handleCreateRoom}
        defaultNickname={effectiveNickname}
        isLoading={actionLoading}
      />

      <IdentityJoinDialog
        open={identityDialogOpen}
        onOpenChange={setIdentityDialogOpen}
        onConfirm={handleIdentityConfirm}
      />

      <PasswordDialog
        open={passwordDialog.open}
        onOpenChange={(open: boolean) => {
          setPasswordDialog((prev) => ({ ...prev, open }))
          if (!open) setPasswordError(null)
        }}
        roomName={passwordDialog.room?.name ?? ''}
        onSubmit={handlePasswordSubmit}
        error={passwordError}
        isLoading={actionLoading}
      />
    </motion.div>
  )
}
