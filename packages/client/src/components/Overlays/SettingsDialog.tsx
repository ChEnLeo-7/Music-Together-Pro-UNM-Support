import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SERVER_URL } from '@/lib/config'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useAccountStore } from '@/stores/accountStore'
import { Keyboard, Languages, KeyRound, Palette, Settings2, Shield, Type, UserCircle, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AccountSection, type AccountMe } from './Settings/AccountSection'
import { AdminSection } from './Settings/AdminSection'
import { AppearanceSection } from './Settings/AppearanceSection'
import { LanguageSection } from './Settings/LanguageSection'
import { LyricsSection } from './Settings/LyricsSection'
import { MembersSection } from './Settings/MembersSection'
import { PlatformHub } from './Settings/PlatformHub'
import { RoomSettingsSection } from './Settings/RoomSettingsSection'
import { ShortcutsSection } from './Settings/ShortcutsSection'

export type SettingsTab = 'room' | 'members' | 'identity' | 'accounts' | 'admin' | 'appearance' | 'lyrics' | 'language' | 'shortcuts'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdateSettings: (settings: {
    name?: string
    password?: string | null
    audioQuality?: import('@music-together/shared').AudioQuality
    sourcePriority?: import('@music-together/shared').SourcePriority
    hidden?: boolean
    permanent?: boolean
    chatHistoryForNewUsers?: boolean
  }) => void
  onDissolveRoom?: () => void
  onSetUserRole?: (userId: string, role: 'admin' | 'member') => void
  initialTab?: SettingsTab
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

const TABS: { id: SettingsTab; icon: LucideIcon; labelKey: I18nKey }[] = [
  { id: 'room', icon: Settings2, labelKey: 'room' },
  { id: 'members', icon: Users, labelKey: 'members' },
  { id: 'identity', icon: UserCircle, labelKey: 'identity' },
  { id: 'accounts', icon: KeyRound, labelKey: 'platforms' },
  { id: 'admin', icon: Shield, labelKey: 'admin' },
  { id: 'appearance', icon: Palette, labelKey: 'appearance' },
  { id: 'lyrics', icon: Type, labelKey: 'lyrics' },
  { id: 'shortcuts', icon: Keyboard, labelKey: 'shortcuts' },
  { id: 'language', icon: Languages, labelKey: 'language' },
]

export function SettingsDialog({
  open,
  onOpenChange,
  onUpdateSettings,
  onDissolveRoom,
  onSetUserRole,
  initialTab,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('room')
  const accountMe = useAccountStore((s) => s.me)
  const accountLoading = useAccountStore((s) => s.loading)
  const setAccountMe = useAccountStore((s) => s.setMe)
  const setAccountLoading = useAccountStore((s) => s.setLoading)
  const t = useI18n((s) => s.t)
  const isServerAdmin = accountMe?.role === 'admin'
  const tabs = TABS.filter((item) => item.id !== 'admin' || isServerAdmin)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setAccountLoading(true)
    fetch(`${SERVER_URL}/api/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AccountMe | null) => {
        if (!cancelled) {
          setAccountMe(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountMe(null)
        }
      })
      .finally(() => {
        if (!cancelled) setAccountLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (open && initialTab && (initialTab !== 'admin' || isServerAdmin)) setTab(initialTab)
  }, [open, initialTab, isServerAdmin])

  useEffect(() => {
    if (tab === 'admin' && !isServerAdmin) setTab('room')
  }, [tab, isServerAdmin])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="w-full max-w-full gap-0 overflow-hidden p-0 md:max-w-[75vw] lg:max-w-[60vw]">
        <ResponsiveDialogDescription className="sr-only">{t('settingsDesc')}</ResponsiveDialogDescription>
        <div className="flex h-[70vh] min-w-0 max-w-full flex-col overflow-hidden md:flex-row">
          <div className="flex min-w-0 shrink-0 flex-col overflow-hidden border-b md:hidden">
            <ResponsiveDialogTitle className="px-4 pt-4 pb-2 text-lg font-semibold">{t('settings')}</ResponsiveDialogTitle>
            <nav className="scrollbar-hide flex max-w-full gap-1 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Settings sections">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    tab === item.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {t(item.labelKey)}
                </button>
              ))}
            </nav>
          </div>

          <nav className="hidden w-48 shrink-0 flex-col border-r p-4 md:flex" role="tablist" aria-label="Settings sections">
            <ResponsiveDialogTitle className="mb-4 px-3 text-lg font-semibold">{t('settings')}</ResponsiveDialogTitle>
            <div className="space-y-1">
              {tabs.map((item) => (
                <NavItem key={item.id} icon={item.icon} label={t(item.labelKey)} active={tab === item.id} onClick={() => setTab(item.id)} />
              ))}
            </div>
          </nav>

          {tab === 'accounts' ? (
            <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto">
              <div className="box-border min-w-0 max-w-full overflow-x-hidden p-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
                <PlatformHub />
              </div>
            </div>
          ) : tab === 'identity' ? (
            <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
              <div className="min-w-0 max-w-full overflow-x-hidden p-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
                <AccountSection initialMe={accountMe} initialLoading={accountLoading} />
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
              <div className="min-w-0 max-w-full overflow-x-hidden p-4 sm:p-6">
                {tab === 'room' && <RoomSettingsSection onUpdateSettings={onUpdateSettings} onDissolveRoom={onDissolveRoom} />}
                {tab === 'members' && <MembersSection onSetUserRole={onSetUserRole} />}
                {tab === 'admin' && <AdminSection />}
                {tab === 'lyrics' && <LyricsSection />}
                {tab === 'shortcuts' && <ShortcutsSection />}
                {tab === 'appearance' && <AppearanceSection />}
                {tab === 'language' && <LanguageSection />}
              </div>
            </ScrollArea>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
