import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useI18n } from '@/lib/i18n'
import type { MusicSource } from '@music-together/shared'
import { X } from 'lucide-react'
import { useState } from 'react'

interface ManualCookieDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: MusicSource
  onSubmit: (cookie: string) => void
}

export function ManualCookieDialog({ open, onOpenChange, platform, onSubmit }: ManualCookieDialogProps) {
  const [cookie, setCookie] = useState('')
  const t = useI18n((s) => s.t)
  const label = t(platform)

  const handleOpenChange = (value: boolean) => {
    onOpenChange(value)
    if (!value) setCookie('')
  }

  const handleSubmit = () => {
    const trimmed = cookie.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setCookie('')
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <ResponsiveDialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-md" showCloseButton={false}>
        <ResponsiveDialogHeader className="relative pr-10">
          <ResponsiveDialogTitle>{t('manualCookieTitle', { platform: label })}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('manualCookieDescription')}</ResponsiveDialogDescription>
          <ResponsiveDialogClose asChild>
            <Button variant="ghost" size="icon" className="absolute top-0 right-0" aria-label={t('close')}>
              <X />
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="min-h-0 flex-1 space-y-3 py-2">
          <textarea
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-32 w-full resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
            placeholder={t('cookiePlaceholder')}
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
          />

          <div className="text-muted-foreground space-y-1.5 text-xs">
            <p className="font-medium">{t('howToGetCookie')}</p>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>{t('openPlatformWeb', { platform: label })}</li>
              <li>
                {t('openDevTools', { key: 'F12' })}
              </li>
              <li>
                {t('openApplicationTab')}
              </li>
              <li>
                {t('copyCookies')}
              </li>
            </ol>
            <p className="mt-2 text-yellow-500">{t('cookieMemoryNotice')}</p>
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!cookie.trim()}>
            {t('submitCookie')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
