import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useContext } from 'react'
import { AbilityContext } from '@/providers/AbilityProvider'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'
import { useI18n } from '@/lib/i18n'

const BETA_BADGE = (
  <span className="rounded bg-yellow-400/20 px-1 py-0.5 text-[10px] font-semibold leading-none text-yellow-600">
    Beta
  </span>
)

export function LyricsSection() {
  const s = useSettingsStore()
  const ability = useContext(AbilityContext)
  const canSeek = ability.can('seek', 'Player')
  const t = useI18n((s) => s.t)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('lyricsSource')}</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label={t('onlineWordLyrics')}
          description={t('onlineWordLyricsDescription')}
          onReset={s.ttmlEnabled !== s.ttmlEnabledDefault ? s.resetTtmlEnabled : undefined}
        >
          <Switch checked={s.ttmlEnabled} onCheckedChange={s.setTtmlEnabled} />
        </SettingRow>

        {s.ttmlEnabled && (
          <SettingRow
            label={t('lyricsDbUrl')}
            description={t('lyricsDbUrlDescription')}
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
        <h3 className="text-base font-semibold">{t('lyricsLayout')}</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label={t('alignmentAnchor')}
          description={t('alignmentAnchorDescription')}
          onReset={s.lyricAlignAnchor !== s.lyricAlignAnchorDefault ? s.resetLyricAlignAnchor : undefined}
        >
          <Select
            value={s.lyricAlignAnchor}
            onValueChange={(v) => s.setLyricAlignAnchor(v as 'top' | 'center' | 'bottom')}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">{t('top')}</SelectItem>
              <SelectItem value="center">{t('center')}</SelectItem>
              <SelectItem value="bottom">{t('bottom')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('alignmentPosition')}
          description={t('currentValue', { value: `${Math.round(s.lyricAlignPosition * 100)}%` })}
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
        <h3 className="text-base font-semibold">{t('lyricsAnimation')}</h3>
        <Separator className="mt-2 mb-4" />

        {canSeek && (
          <SettingRow
            label={t('clickLyricsToSeek')}
            labelExtra={BETA_BADGE}
            description={t('clickLyricsToSeekDescription')}
            onReset={
              s.lyricClickSeekEnabled !== s.lyricClickSeekEnabledDefault ? s.resetLyricClickSeekEnabled : undefined
            }
          >
            <Switch checked={s.lyricClickSeekEnabled} onCheckedChange={s.setLyricClickSeekEnabled} />
          </SettingRow>
        )}

        <SettingRow
          label={t('springAnimation')}
          description={t('springAnimationDescription')}
          onReset={s.lyricEnableSpring !== s.lyricEnableSpringDefault ? s.resetLyricEnableSpring : undefined}
        >
          <Switch checked={s.lyricEnableSpring} onCheckedChange={s.setLyricEnableSpring} />
        </SettingRow>

        <SettingRow
          label={t('blurEffect')}
          description={t('blurEffectDescription')}
          onReset={s.lyricEnableBlur !== s.lyricEnableBlurDefault ? s.resetLyricEnableBlur : undefined}
        >
          <Switch checked={s.lyricEnableBlur} onCheckedChange={s.setLyricEnableBlur} />
        </SettingRow>

        <SettingRow
          label={t('scaleEffect')}
          description={t('scaleEffectDescription')}
          onReset={s.lyricEnableScale !== s.lyricEnableScaleDefault ? s.resetLyricEnableScale : undefined}
        >
          <Switch checked={s.lyricEnableScale} onCheckedChange={s.setLyricEnableScale} />
        </SettingRow>

        <SettingRow
          label={t('hidePlayedLyrics')}
          description={t('hidePlayedLyricsDescription')}
          onReset={s.lyricHidePassedLines !== s.lyricHidePassedLinesDefault ? s.resetLyricHidePassedLines : undefined}
        >
          <Switch checked={s.lyricHidePassedLines} onCheckedChange={s.setLyricHidePassedLines} />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">{t('lyricsFont')}</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label={t('fontWeight')}
          description={t('fontWeightDescription')}
          onReset={s.lyricFontWeight !== s.lyricFontWeightDefault ? s.resetLyricFontWeight : undefined}
        >
          <NumericInput value={s.lyricFontWeight} onChange={s.setLyricFontWeight} min={100} max={900} />
        </SettingRow>

        <SettingRow
          label={t('fontSize')}
          description={t('fontSizeDescription')}
          onReset={s.lyricFontSize !== s.lyricFontSizeDefault ? s.resetLyricFontSize : undefined}
        >
          <NumericInput value={s.lyricFontSize} onChange={s.setLyricFontSize} />
        </SettingRow>

        <SettingRow
          label={t('translationFontSize')}
          description={t('translationFontSizeDescription')}
          onReset={
            s.lyricTranslationFontSize !== s.lyricTranslationFontSizeDefault
              ? s.resetLyricTranslationFontSize
              : undefined
          }
        >
          <NumericInput value={s.lyricTranslationFontSize} onChange={s.setLyricTranslationFontSize} />
        </SettingRow>

        <SettingRow
          label={t('romanFontSize')}
          description={t('romanFontSizeDescription')}
          onReset={s.lyricRomanFontSize !== s.lyricRomanFontSizeDefault ? s.resetLyricRomanFontSize : undefined}
        >
          <NumericInput value={s.lyricRomanFontSize} onChange={s.setLyricRomanFontSize} />
        </SettingRow>
      </div>
    </div>
  )
}
