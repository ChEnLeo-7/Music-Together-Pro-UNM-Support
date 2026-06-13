import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useAccountStore } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'

const BETA_BADGE = <span className="rounded bg-yellow-400/20 px-1 py-0.5 text-[10px] font-semibold leading-none text-yellow-600">Beta</span>

export function LyricsSection() {
  const s = useSettingsStore()
  const isRoomAdmin = useRoomStore((state) => state.currentUser?.role === 'owner' || state.currentUser?.role === 'admin')
  const isServerAdmin = useAccountStore((state) => state.me?.role === 'admin')
  const canManageRoom = isRoomAdmin || isServerAdmin

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">歌词源</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="TTML 在线逐词歌词"
          description="启用 AMLL 逐词歌词库，仅网易云/QQ 音乐自动匹配"
          onReset={s.ttmlEnabled !== s.ttmlEnabledDefault ? s.resetTtmlEnabled : undefined}
        >
          <Switch checked={s.ttmlEnabled} onCheckedChange={s.setTtmlEnabled} />
        </SettingRow>

        {s.ttmlEnabled && (
          <SettingRow
            label="TTML 歌词库地址"
            description="URL 模板，%s 会被替换为歌曲 ID，QQ 音乐会自动替换路径"
            onReset={s.ttmlDbUrl !== s.ttmlDbUrlDefault ? s.resetTtmlDbUrl : undefined}
          >
            <Input
              value={s.ttmlDbUrl}
              onChange={(e) => s.setTtmlDbUrl(e.target.value)}
              placeholder="https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml"
              className="w-64 text-xs"
            />
          </SettingRow>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词布局</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="对齐锚点"
          description="当前歌词行在视口中的锚定方式"
          onReset={s.lyricAlignAnchor !== s.lyricAlignAnchorDefault ? s.resetLyricAlignAnchor : undefined}
        >
          <Select value={s.lyricAlignAnchor} onValueChange={(v) => s.setLyricAlignAnchor(v as 'top' | 'center' | 'bottom')}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">顶部</SelectItem>
              <SelectItem value="center">居中</SelectItem>
              <SelectItem value="bottom">底部</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="对齐位置"
          description={`当前: ${Math.round(s.lyricAlignPosition * 100)}%`}
          onReset={s.lyricAlignPosition !== s.lyricAlignPositionDefault ? s.resetLyricAlignPosition : undefined}
        >
          <Slider
            value={[s.lyricAlignPosition * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => s.setLyricAlignPosition(v[0] / 100)}
            className="w-32"
          />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词动画</h3>
        <Separator className="mt-2 mb-4" />

        {canManageRoom && (
          <SettingRow
            label="点击歌词跳转"
            labelExtra={BETA_BADGE}
            description="开启后点击歌词会跳转播放，可能出现滚动动画异常"
            onReset={s.lyricClickSeekEnabled !== s.lyricClickSeekEnabledDefault ? s.resetLyricClickSeekEnabled : undefined}
          >
            <Switch checked={s.lyricClickSeekEnabled} onCheckedChange={s.setLyricClickSeekEnabled} />
          </SettingRow>
        )}

        <SettingRow
          label="弹簧动画"
          description="歌词行切换时使用物理弹簧效果"
          onReset={s.lyricEnableSpring !== s.lyricEnableSpringDefault ? s.resetLyricEnableSpring : undefined}
        >
          <Switch checked={s.lyricEnableSpring} onCheckedChange={s.setLyricEnableSpring} />
        </SettingRow>

        <SettingRow
          label="模糊效果"
          description="非当前行歌词模糊"
          onReset={s.lyricEnableBlur !== s.lyricEnableBlurDefault ? s.resetLyricEnableBlur : undefined}
        >
          <Switch checked={s.lyricEnableBlur} onCheckedChange={s.setLyricEnableBlur} />
        </SettingRow>

        <SettingRow
          label="缩放效果"
          description="当前行歌词放大突出显示"
          onReset={s.lyricEnableScale !== s.lyricEnableScaleDefault ? s.resetLyricEnableScale : undefined}
        >
          <Switch checked={s.lyricEnableScale} onCheckedChange={s.setLyricEnableScale} />
        </SettingRow>

        <SettingRow
          label="隐藏已播放歌词"
          description="当前歌词播放完后逐渐淡出已播放行"
          onReset={s.lyricHidePassedLines !== s.lyricHidePassedLinesDefault ? s.resetLyricHidePassedLines : undefined}
        >
          <Switch checked={s.lyricHidePassedLines} onCheckedChange={s.setLyricHidePassedLines} />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词字体</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="字体粗细"
          description="字体粗细值，范围 100-900"
          onReset={s.lyricFontWeight !== s.lyricFontWeightDefault ? s.resetLyricFontWeight : undefined}
        >
          <NumericInput value={s.lyricFontWeight} onChange={s.setLyricFontWeight} min={100} max={900} />
        </SettingRow>

        <SettingRow
          label="字体大小"
          description="主歌词字号比例，范围 10-200"
          onReset={s.lyricFontSize !== s.lyricFontSizeDefault ? s.resetLyricFontSize : undefined}
        >
          <NumericInput value={s.lyricFontSize} onChange={s.setLyricFontSize} />
        </SettingRow>

        <SettingRow
          label="翻译字体大小"
          description="翻译歌词相对主歌词的字号比例，范围 10-200"
          onReset={s.lyricTranslationFontSize !== s.lyricTranslationFontSizeDefault ? s.resetLyricTranslationFontSize : undefined}
        >
          <NumericInput value={s.lyricTranslationFontSize} onChange={s.setLyricTranslationFontSize} />
        </SettingRow>

        <SettingRow
          label="罗马音字体大小"
          description="罗马音歌词相对主歌词的字号比例，范围 10-200"
          onReset={s.lyricRomanFontSize !== s.lyricRomanFontSizeDefault ? s.resetLyricRomanFontSize : undefined}
        >
          <NumericInput value={s.lyricRomanFontSize} onChange={s.setLyricRomanFontSize} />
        </SettingRow>
      </div>
    </div>
  )
}
