import { motion } from 'motion/react'
import { useI18n } from '@/lib/i18n'

export function HeroSection() {
  const t = useI18n((s) => s.t)
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mb-8 text-center"
    >
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t('lobbyTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('lobbyDescription')}</p>
    </motion.div>
  )
}
