import { useSocketContext } from '@/providers/SocketProvider'
import { EVENTS } from '@music-together/shared'
import type { MusicSource } from '@music-together/shared'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { getLocalizedError, useI18n } from '@/lib/i18n'

const PLATFORM_NAMES: Record<MusicSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
}

/**
 * Hook：认证结果处理（always-mounted 级别）
 *
 * 统一处理认证结果事件。凭据始终由服务端保存和恢复，客户端只处理
 * 状态通知，因此不会在浏览器存储或事件响应中接触可重放的 Cookie。
 *
 * 设计决策：
 * - 自动恢复由服务端在房间加载时完成
 */
export function useAuthSync() {
  const { socket } = useSocketContext()
  const t = useI18n((s) => s.t)

  useEffect(() => {
    const onAuthCookieResult = (data: {
      success: boolean
      message: string
      platform?: MusicSource
      reason?: 'expired' | 'error'
    }) => {
       if (data.success) {
         toast.success(t('authSuccess'))
       } else if (data.platform) {
        const name = PLATFORM_NAMES[data.platform] ?? data.platform

        if (data.reason === 'expired') {
           toast.warning(t('authRetry', { platform: name }), { id: `auth-expired-${data.platform}` })
        } else if (data.reason === 'error') {
           toast.info(t('authRetry', { platform: name }), { id: `auth-error-${data.platform}` })
        } else {
          // 手动操作失败
           toast.error(getLocalizedError(data, t))
        }
        // Cookie 永不删除 — 只有 useAuth.logout() 有权删除
      }
    }

    socket.on(EVENTS.AUTH_SET_COOKIE_RESULT, onAuthCookieResult)

    return () => {
      socket.off(EVENTS.AUTH_SET_COOKIE_RESULT, onAuthCookieResult)
    }
  }, [socket, t])
}
