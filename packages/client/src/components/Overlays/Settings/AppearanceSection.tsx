import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'

export function AppearanceSection() {
  const s = useSettingsStore()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">背景渲染</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="性能优化"
          description="启用实验性的性能优化，不一定保证流畅"
          labelExtra={<span className="rounded bg-yellow-400/20 px-1 py-0.5 text-[10px] font-semibold leading-none text-yellow-600">Beta</span>}
        >
          <Switch checked={s.performanceOptimization} onCheckedChange={s.setPerformanceOptimization} />
        </SettingRow>

        <SettingRow label="隐藏顶部音源来源" description="关闭左上角延迟旁边的音源/音质切换入口">
          <Switch checked={s.hidePlayerQualityButton} onCheckedChange={s.setHidePlayerQualityButton} />
        </SettingRow>

        <SettingRow
          label="帧率"
          description="更高帧率更流畅，但消耗更多性能"
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
          label="流动速度"
          description={`当前: ${s.bgFlowSpeed.toFixed(1)}`}
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
          label="渲染精度"
          description="更低精度更省性能"
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
