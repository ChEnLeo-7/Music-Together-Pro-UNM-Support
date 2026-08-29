import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useI18n } from '@/lib/i18n'
import type { MusicSource } from '@music-together/shared'
import { QR_STATUS, QR_TIMING } from '@music-together/shared'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Smartphone, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface QrLoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: MusicSource
  qrData: { key: string; qrimg: string } | null
  qrStatus: { status: number; message: string } | null
  isLoading: boolean
  onRefresh: () => void
  onCheckStatus: (key: string) => void
}

export function QrLoginDialog({
  open,
  onOpenChange,
  platform,
  qrData,
  qrStatus,
  isLoading,
  onRefresh,
  onCheckStatus,
}: QrLoginDialogProps) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const t = useI18n((s) => s.t)
  const label = t(platform)
  const scanApp = platform === 'tencent' ? t('phoneQq') : `${label} App`

  // Auto-poll QR status every 2 seconds when dialog is open and QR is generated
  useEffect(() => {
    if (!open || !qrData?.key) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    pollRef.current = setInterval(() => {
      onCheckStatus(qrData.key)
    }, QR_TIMING.POLL_INTERVAL_MS)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [open, qrData?.key, onCheckStatus])

  // On success or expiry: stop polling immediately + auto-close on success
  useEffect(() => {
    const status = qrStatus?.status
    if (status === QR_STATUS.EXPIRED || status === QR_STATUS.SUCCESS) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    if (status === QR_STATUS.SUCCESS) {
      const t = setTimeout(() => onOpenChange(false), QR_TIMING.SUCCESS_CLOSE_DELAY_MS)
      return () => clearTimeout(t)
    }
  }, [qrStatus?.status, onOpenChange])

  const statusCode = qrStatus?.status ?? 0

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-sm" showCloseButton={false}>
        <ResponsiveDialogHeader className="relative pr-10">
          <ResponsiveDialogTitle>{t('qrLoginTitle', { platform: label })}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('qrLoginDescription', { app: scanApp })}</ResponsiveDialogDescription>
          <ResponsiveDialogClose asChild>
            <Button variant="ghost" size="icon" className="absolute top-0 right-0" aria-label={t('close')}>
              <X />
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col items-center gap-4 py-4">
          {/* QR Code */}
          <div className="relative flex h-52 w-52 items-center justify-center rounded-lg border bg-white">
            {isLoading && <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />}
            {!isLoading && qrData?.qrimg && (
              <>
                <img
                  src={qrData.qrimg}
                  alt={t('qrCodeAlt', { platform: label })}
                  className="h-full w-full rounded-lg object-contain p-2"
                />
                {/* Overlay for expired/success */}
                {statusCode === QR_STATUS.EXPIRED && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/60">
                    <AlertCircle className="mb-2 h-8 w-8 text-white" />
                    <p className="text-sm text-white">{t('qrExpired')}</p>
                  </div>
                )}
                {statusCode === QR_STATUS.SUCCESS && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-green-600/80">
                    <CheckCircle2 className="mb-2 h-8 w-8 text-white" />
                    <p className="text-sm text-white">{t('loginSuccess')}</p>
                  </div>
                )}
              </>
            )}
            {!isLoading && !qrData && <p className="text-muted-foreground text-sm">{t('qrGenerateFailed')}</p>}
          </div>

          {/* Status message */}
          <div className="flex items-center gap-2 text-sm">
            {statusCode === QR_STATUS.WAITING_SCAN && (
              <>
                <Smartphone className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground">{t('openAppToScan', { app: scanApp })}</span>
              </>
            )}
            {statusCode === QR_STATUS.SCANNED && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <span className="text-blue-600">{t('qrScannedConfirm')}</span>
              </>
            )}
            {statusCode === QR_STATUS.SUCCESS && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-green-600">{t('loginSuccessExclamation')}</span>
              </>
            )}
            {statusCode === QR_STATUS.EXPIRED && (
              <>
                <AlertCircle className="text-destructive h-4 w-4" />
                <span className="text-destructive">{t('qrExpired')}</span>
              </>
            )}
          </div>

          {/* Refresh button */}
          {(statusCode === QR_STATUS.EXPIRED || (!qrData && !isLoading)) && (
            <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {t('refreshQrCode')}
            </Button>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
