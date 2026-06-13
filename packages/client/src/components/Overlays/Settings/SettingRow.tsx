import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n'
import { RotateCcw } from 'lucide-react'

export function SettingRow({
  label,
  labelExtra,
  description,
  onReset,
  children,
}: {
  label: React.ReactNode
  labelExtra?: React.ReactNode
  description?: string
  /** 传入时显示重置按钮，点击触发回调 */
  onReset?: () => void
  children: React.ReactNode
}) {
  const t = useI18n((s) => s.t)

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">{label}</Label>
          {labelExtra}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onReset && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onReset}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('resetDefault')}</TooltipContent>
          </Tooltip>
        )}
        {children}
      </div>
    </div>
  )
}
