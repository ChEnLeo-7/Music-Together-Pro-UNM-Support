import { useEffect, useRef, useState } from 'react'
import { CircleUser, KeyRound, Loader2, LogOut } from 'lucide-react'
import { LIMITS } from '@music-together/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { storage } from '@/lib/storage'
import { toast } from 'sonner'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore } from '@/stores/accountStore'
import { fetchCurrentAccount, loginIdentity, logoutIdentity, useGuestIdentity } from '@/lib/identityAuth'

export function UserPopover() {
  const { socket } = useSocketContext()
  const me = useAccountStore((s) => s.me)
  const [nickname, setNickname] = useState(storage.getNickname())
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const prevValueRef = useRef(storage.getNickname())

  useEffect(() => {
    void fetchCurrentAccount().catch(() => undefined)
  }, [])

  const handleSaveNickname = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) return
    if (trimmed !== prevValueRef.current) {
      setLoading(true)
      try {
        await useGuestIdentity(socket, trimmed)
        prevValueRef.current = trimmed
        toast.success('昵称已保存')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '昵称保存失败')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!accountId.trim() || !password) return
    setLoading(true)
    try {
      const account = await loginIdentity(socket, accountId, password)
      setNickname(account.nickname)
      prevValueRef.current = account.nickname
      setPassword('')
      setLoginOpen(false)
      setGuestOpen(false)
      toast.success('登录成功')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    try {
      await logoutIdentity(socket)
      setNickname('')
      prevValueRef.current = ''
      setLoginOpen(false)
      setGuestOpen(false)
      toast.info('已退出账号，下次进入房间需要选择账号登录或游客访问')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '退出失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGuest = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      const account = await useGuestIdentity(socket, trimmed)
      setNickname(account?.nickname ?? trimmed)
      prevValueRef.current = account?.nickname ?? trimmed
      setLoginOpen(false)
      setGuestOpen(false)
      toast.success('已切换为游客身份')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleSaveNickname()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const current = storage.getNickname()
      setNickname(current)
      prevValueRef.current = current
      setGuestOpen(false)
    }
    setOpen(nextOpen)
  }

  const displayName = me?.nickname || storage.getNickname()
  const initial = displayName ? displayName.charAt(0).toUpperCase() : null
  const hasIdentity = Boolean(displayName || me?.hasPassword)

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full border border-border/60">
          {initial ? <span className="text-sm font-semibold">{initial}</span> : <CircleUser className="h-5 w-5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">身份</p>
            <p className="truncate text-xs text-muted-foreground">
              {me?.hasPassword ? `已登录: ${displayName || me.id}` : displayName ? `游客: ${displayName}` : '尚未设置身份'}
            </p>
          </div>

          <Separator />

          {loginOpen ? (
            <form onSubmit={handleLogin} className="space-y-2">
              <Input placeholder="账号 ID" value={accountId} onChange={(e) => setAccountId(e.target.value)} autoFocus />
              <Input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={loading || !accountId.trim() || !password}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  登录
                </Button>
                <Button type="button" variant="outline" onClick={() => setLoginOpen(false)} disabled={loading}>
                  取消
                </Button>
              </div>
            </form>
          ) : guestOpen ? (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">游客昵称</label>
                <Input
                  placeholder="输入昵称..."
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleGuest()
                  }}
                  maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={() => void handleGuest()} disabled={loading || !nickname.trim()}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  确认
                </Button>
                <Button type="button" variant="outline" onClick={() => setGuestOpen(false)} disabled={loading}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <>
              {!me?.hasPassword && displayName && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">游客昵称</label>
                  <Input
                    placeholder="输入昵称..."
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    onBlur={() => void handleSaveNickname()}
                    onKeyDown={handleKeyDown}
                    maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                    className="h-8 text-sm"
                  />
                </div>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setLoginOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  登录账号
                </Button>
                {me?.hasPassword ? (
                  <Button type="button" variant="ghost" className="text-destructive" onClick={() => void handleLogout()} disabled={loading}>
                    <LogOut className="mr-2 h-4 w-4" />
                    退出
                  </Button>
                ) : !hasIdentity ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setNickname('')
                      setGuestOpen(true)
                    }}
                    disabled={loading}
                  >
                    游客访问
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
