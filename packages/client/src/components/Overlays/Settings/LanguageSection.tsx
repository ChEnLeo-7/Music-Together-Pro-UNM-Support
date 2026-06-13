import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useI18n, type Language } from '@/lib/i18n'
import { SettingRow } from './SettingRow'

export function LanguageSection() {
  const language = useI18n((s) => s.language)
  const setLanguage = useI18n((s) => s.setLanguage)
  const t = useI18n((s) => s.t)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('languageTitle')}</h3>
        <Separator className="mt-2 mb-4" />
        <SettingRow label={t('displayLanguage')} description={t('languageDescription')}>
          <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{t('simplifiedChinese')}</SelectItem>
              <SelectItem value="en-US">{t('english')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </div>
  )
}
