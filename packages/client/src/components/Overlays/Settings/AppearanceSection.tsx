import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'
import { useI18n } from '@/lib/i18n'

export function AppearanceSection() {
  const s = useSettingsStore()
  const t = useI18n((state) => state.t)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('backgroundRendering')}</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label={t('hideSourceButton')} description={t('hideSourceButtonDescription')}>
          <Switch checked={s.hidePlayerQualityButton} onCheckedChange={s.setHidePlayerQualityButton} />
        </SettingRow>

        <SettingRow
          label={t('frameRate')}
          description={t('frameRateDescription')}
          onReset={s.bgFps !== s.bgFpsDefault ? s.resetBgFps : undefined}
        >
          <Select value={String(s.bgFps)} onValueChange={(v) => s.setBgFps(parseInt(v, 10))}>
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

        <SettingRow
          label={t('flowSpeed')}
          description={t('currentValue', { value: s.bgFlowSpeed.toFixed(1) })}
          onReset={s.bgFlowSpeed !== s.bgFlowSpeedDefault ? s.resetBgFlowSpeed : undefined}
        >
          <Slider
            value={[s.bgFlowSpeed * 10]}
            min={5}
            max={50}
            step={5}
            onValueChange={(v) => s.setBgFlowSpeed(v[0] / 10)}
            className="w-32"
          />
        </SettingRow>

        <SettingRow
          label={t('renderScale')}
          description={t('renderScaleDescription')}
          onReset={s.bgRenderScale !== s.bgRenderScaleDefault ? s.resetBgRenderScale : undefined}
        >
          <Select value={String(s.bgRenderScale)} onValueChange={(v) => s.setBgRenderScale(parseFloat(v))}>
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
