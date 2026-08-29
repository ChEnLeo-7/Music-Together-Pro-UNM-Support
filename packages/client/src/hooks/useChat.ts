import { useCallback } from 'react'
import { EVENTS, LIMITS } from '@music-together/shared'
import { useSocketContext } from '@/providers/SocketProvider'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

export function useChat() {
  const { socket } = useSocketContext()
  const t = useI18n((s) => s.t)

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      if (trimmed.length > LIMITS.CHAT_CONTENT_MAX_LENGTH) {
         toast.error(t('chatTooLong', { limit: LIMITS.CHAT_CONTENT_MAX_LENGTH }))
        return
      }
      socket.emit(EVENTS.CHAT_MESSAGE, { content: trimmed })
    },
     [socket, t],
  )

  return { sendMessage }
}
