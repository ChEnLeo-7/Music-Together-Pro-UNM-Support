import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Label } from '@/components/ui/label'
import { useSocketContext } from '@/providers/SocketProvider'
import { LIMITS } from '@music-together/shared'
import { KeyRound, Loader2, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { loginIdentity, useGuestIdentity } from '@/lib/identityAuth'
import { storage } from '@/lib/storage'

interface IdentityJoinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (nickname: string) => void
}

export function IdentityJoinDialog({ open, onOpenChange, onConfirm }: IdentityJoinDialogProps) {
  const { socket } = useSocketContext()
  const [mode, setMode] = useState<'account' | 'guest'>('account')
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState(storage.getNickname())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode('account')
    setPassword('')
    setNickname(storage.getNickname())
  }, [open])

  const handleAccountSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!accountId.trim() || !password) return
    setLoading(true)
    try {
      const me = await loginIdentity(socket, accountId, password)
      toast.success('登录成功')
      onOpenChange(false)
      onConfirm(me.nickname || me.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGuestSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = nickname.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      await useGuestIdentity(socket, trimmed)
      onOpenChange(false)
      onConfirm(trimmed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '游客访问失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            {mode === 'account' ? <KeyRound className="h-5 w-5 text-primary" /> : <UserRound className="h-5 w-5 text-primary" />}
            {mode === 'account' ? '账号登录' : '游客访问'}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {mode === 'account' ? '输入账号 ID 和密码后，将以该身份进入房间。' : '输入临时昵称后，以普通成员身份进入房间。'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {mode === 'account' ? (
            <form onSubmit={handleAccountSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="join-account-id">账号 ID</Label>
                <Input id="join-account-id" value={accountId} onChange={(e) => setAccountId(e.target.value)} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-account-password">密码</Label>
                <Input
                  id="join-account-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !accountId.trim() || !password}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                登录并加入
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={() => setMode('guest')}>
                游客访问
              </Button>
            </form>
          ) : (
            <form onSubmit={handleGuestSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="join-guest-nickname">昵称</Label>
                <Input
                  id="join-guest-nickname"
                  placeholder="你的昵称..."
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !nickname.trim()}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                以游客身份加入
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={() => setMode('account')}>
                返回账号登录
              </Button>
            </form>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
