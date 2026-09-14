import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Loader2, Lock } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

interface PasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomName: string
  onSubmit: (password: string) => void
  error: string | null
  isLoading: boolean
}

export function PasswordDialog({ open, onOpenChange, roomName, onSubmit, error, isLoading }: PasswordDialogProps) {
  const [password, setPassword] = useState('')
  const t = useI18n((s) => s.t)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setPassword('')
    onOpenChange(nextOpen)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.length) return
    onSubmit(password)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5 text-muted-foreground" />
            {t('passwordProtection')}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('roomPasswordSetDescription', { room: roomName })}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div animate={error ? { x: [-8, 8, -6, 6, -3, 3, 0] } : {}} transition={{ duration: 0.5 }}>
              <Input
                type="password"
                placeholder={t('roomPasswordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                className={error ? 'border-destructive' : ''}
              />
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-1.5 text-xs text-destructive"
                >
                  {error}
                </motion.p>
              )}
            </motion.div>

            <Button type="submit" className="w-full" disabled={isLoading || !password.length}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('joinRoom')}
            </Button>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
