import { motion, useReducedMotion } from 'motion/react'
import { Headphones, KeyRound, Loader2, Lock, UserRound } from 'lucide-react'
import { LIMITS } from '@music-together/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/SocketProvider'
import { loginIdentity, useGuestIdentity } from '@/lib/identityAuth'
import { toast } from 'sonner'

interface InteractionGateProps {
  onStart: (password?: string, nickname?: string) => void
  roomName?: string
  hasPassword?: boolean
  passwordError?: string | null
}

export function InteractionGate({ onStart, roomName, hasPassword, passwordError }: InteractionGateProps) {
  const { socket } = useSocketContext()
  const prefersReducedMotion = useReducedMotion()
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'account' | 'guest'>('account')
  const [accountId, setAccountId] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const savedNickname = storage.getNickname()
  const needsIdentity = !savedNickname
  const [nickname, setNickname] = useState(savedNickname)

  const identityReady = !needsIdentity || (mode === 'account' ? accountId.trim() && accountPassword : nickname.trim())
  const canStart = Boolean(identityReady) && (!hasPassword || password.trim().length > 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canStart) return
    setLoading(true)
    try {
      let joinNickname = savedNickname
      if (needsIdentity) {
        if (mode === 'account') {
          const me = await loginIdentity(socket, accountId, accountPassword)
          joinNickname = me.nickname || me.id
          toast.success('登录成功')
        } else {
          const me = await useGuestIdentity(socket, nickname)
          joinNickname = me?.nickname || nickname.trim()
        }
      }
      onStart(hasPassword ? password.trim() : undefined, joinNickname)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '身份切换失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-card p-10 shadow-lg"
      >
        <motion.div
          animate={prefersReducedMotion ? {} : { rotate: [0, 5, -5, 0] }}
          transition={prefersReducedMotion ? {} : { duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Headphones className="h-16 w-16 text-primary" />
        </motion.div>

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h2 className="text-xl font-semibold">准备就绪</h2>
          {roomName ? (
            <p className="text-sm text-muted-foreground">即将加入「{roomName}」</p>
          ) : (
            <p className="text-sm text-muted-foreground">点击开始，和房间好友一起听歌</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
          {needsIdentity && mode === 'account' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                <span>账号登录</span>
              </div>
              <Input placeholder="账号 ID" value={accountId} onChange={(e) => setAccountId(e.target.value)} autoFocus />
              <Input type="password" placeholder="密码" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} />
            </div>
          )}

          {needsIdentity && mode === 'guest' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="gate-nickname" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" />
                <span>游客昵称</span>
              </Label>
              <Input
                id="gate-nickname"
                placeholder="你的昵称..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                autoFocus
              />
            </div>
          )}

          {hasPassword && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                <span>该房间需要密码</span>
              </div>
              <motion.div animate={passwordError ? { x: [-8, 8, -6, 6, -3, 3, 0] } : {}} transition={{ duration: 0.5 }}>
                <Input
                  type="password"
                  placeholder="输入房间密码..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={!needsIdentity}
                  className={passwordError ? 'border-destructive' : ''}
                />
                {passwordError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-1.5 text-xs text-destructive"
                  >
                    {passwordError}
                  </motion.p>
                )}
              </motion.div>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={loading || !canStart} aria-label="开始收听">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {needsIdentity && mode === 'account' ? '登录并进入房间' : '开始收听'}
          </Button>
          {needsIdentity && (
            <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={() => setMode(mode === 'account' ? 'guest' : 'account')}>
              {mode === 'account' ? '游客访问' : '返回账号登录'}
            </Button>
          )}
        </form>
      </motion.div>
    </div>
  )
}
