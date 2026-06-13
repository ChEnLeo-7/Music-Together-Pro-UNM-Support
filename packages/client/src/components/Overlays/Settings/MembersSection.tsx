import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SERVER_URL } from '@/lib/config'
import { useI18n } from '@/lib/i18n'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { EVENTS } from '@music-together/shared'
import type { UserRole } from '@music-together/shared'
import { Crown, Shield, Trash2, User } from 'lucide-react'
import { useEffect } from 'react'

interface MembersSectionProps {
  onSetUserRole?: (userId: string, role: 'admin' | 'member') => void
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 }

function getRoleIcon(role: UserRole) {
  switch (role) {
    case 'owner':
      return <Crown className="h-4 w-4 text-yellow-500" />
    case 'admin':
      return <Shield className="h-4 w-4 text-blue-400" />
    case 'member':
      return <User className="h-4 w-4 text-muted-foreground" />
  }
}

function resolveAvatarUrl(avatarUrl?: string | null): string | undefined {
  if (!avatarUrl) return undefined
  return avatarUrl.startsWith('/uploads/') ? `${SERVER_URL}${avatarUrl}` : avatarUrl
}

function getInitial(nickname: string): string {
  return (nickname || '?').slice(0, 1).toUpperCase()
}

export function MembersSection({ onSetUserRole }: MembersSectionProps) {
  const { socket } = useSocketContext()
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const isOwner = currentUser?.role === 'owner'
  const isServerAdmin = useAccountStore((s) => s.me?.role === 'admin')
  const canManageRoom = isOwner || isServerAdmin
  const t = useI18n((s) => s.t)
  const roleLabels: Record<UserRole, string> = {
    owner: t('owner'),
    admin: t('memberAdmin'),
    member: t('member'),
  }

  useEffect(() => {
    socket.emit(EVENTS.ROOM_REFRESH)
  }, [socket])

  const visibleUsers = room?.users ?? []
  const onlineCount = visibleUsers.filter((user) => user.online !== false).length

  const hideMember = (userId: string) => {
    socket.emit(EVENTS.ROOM_HIDE_MEMBER, { userId })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">
          {t('membersOnline')} ({onlineCount})
        </h3>
        <Separator className="mt-2 mb-4" />

        <div className="space-y-1">
          {[...visibleUsers]
            .sort((a, b) => {
              const onlineDelta = Number(b.online !== false) - Number(a.online !== false)
              if (onlineDelta !== 0) return onlineDelta
              return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
            })
            .map((user) => (
              <div key={user.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                <Avatar size="sm" className={user.online === false ? 'opacity-50' : undefined}>
                  <AvatarImage src={resolveAvatarUrl(user.avatarUrl)} alt="" />
                  <AvatarFallback className="bg-gradient-to-br from-emerald-500 via-sky-500 to-fuchsia-500 text-white">
                    {getInitial(user.nickname)}
                  </AvatarFallback>
                </Avatar>
                <span className="shrink-0">{getRoleIcon(user.role)}</span>
                <span className={user.online === false ? 'min-w-0 truncate text-sm text-muted-foreground' : 'min-w-0 truncate text-sm'}>
                  {user.nickname}
                </span>
                {user.id === currentUser?.id && (
                  <Badge variant="secondary" className="text-xs">
                    {t('you')}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {roleLabels[user.role]}
                </Badge>

                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {user.online === false ? (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {t('offline')}
                    </Badge>
                  ) : (
                    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-xs text-emerald-400 hover:bg-emerald-500/20">
                      在线
                    </Badge>
                  )}

                  {canManageRoom && user.role !== 'owner' && user.id !== currentUser?.id && onSetUserRole && (
                    <Select value={user.role} onValueChange={(v) => onSetUserRole(user.id, v as 'admin' | 'member')}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">{t('memberAdmin')}</SelectItem>
                        <SelectItem value="member">{t('member')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {canManageRoom && user.role !== 'owner' && user.id !== currentUser?.id && user.online === false && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => hideMember(user.id)}
                      aria-label={t('hideMemberRecord')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
