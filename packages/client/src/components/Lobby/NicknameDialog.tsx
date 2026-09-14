import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { LIMITS } from '@music-together/shared'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { storage } from '@/lib/storage'
import { useI18n } from '@/lib/i18n'

interface NicknameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (nickname: string) => void
}

export function NicknameDialog({ open, onOpenChange, onConfirm }: NicknameDialogProps) {
  const [nickname, setNickname] = useState(storage.getNickname())
  const t = useI18n((s) => s.t)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = nickname.trim()
    if (!trimmed) return
    storage.setNickname(trimmed)
    onConfirm(trimmed)
  }

  // Sync from storage every time the dialog opens
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setNickname(storage.getNickname())
    }
    onOpenChange(nextOpen)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <UserRound className="h-5 w-5 text-primary" />
            {t('setNickname')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('setNicknameDescription')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nickname-input">{t('nickname')}</Label>
              <Input
                id="nickname-input"
                placeholder={t('nicknamePlaceholder')}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                autoFocus
              />
            </div>

            <Button type="submit" className="w-full" disabled={!nickname.trim()}>
              {t('confirmAndJoin')}
            </Button>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
