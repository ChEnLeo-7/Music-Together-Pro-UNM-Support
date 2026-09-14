import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'
import { useI18n } from '@/lib/i18n'

export function OtherSettingsSection() {
  const bgFps = useSettingsStore((s) => s.bgFps)
  const bgFlowSpeed = useSettingsStore((s) => s.bgFlowSpeed)
  const bgRenderScale = useSettingsStore((s) => s.bgRenderScale)
  const setBgFps = useSettingsStore((s) => s.setBgFps)
  const setBgFlowSpeed = useSettingsStore((s) => s.setBgFlowSpeed)
  const setBgRenderScale = useSettingsStore((s) => s.setBgRenderScale)
  const t = useI18n((s) => s.t)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('backgroundRendering')}</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label={t('frameRate')} description={t('frameRateDescription')}>
          <Select value={String(bgFps)} onValueChange={(v) => setBgFps(parseInt(v, 10))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 FPS</SelectItem>
              <SelectItem value="30">30 FPS</SelectItem>
              <SelectItem value="60">60 FPS</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow label={t('flowSpeed')} description={t('currentValue', { value: bgFlowSpeed.toFixed(1) })}>
          <Slider
            value={[bgFlowSpeed * 10]}
            min={5}
            max={50}
            step={5}
            onValueChange={(v) => setBgFlowSpeed(v[0] / 10)}
            className="w-32"
          />
        </SettingRow>

        <SettingRow label={t('renderScale')} description={t('renderScaleDescription')}>
          <Select value={String(bgRenderScale)} onValueChange={(v) => setBgRenderScale(parseFloat(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.25">25%</SelectItem>
              <SelectItem value="0.5">50%</SelectItem>
              <SelectItem value="0.75">75%</SelectItem>
              <SelectItem value="1">100%</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </div>
  )
}
