import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, formatShortcutKey, type ShortcutAction, useShortcutStore } from '@/stores/shortcutStore'
import { useEffect, useState } from 'react'

const ORDER: ShortcutAction[] = ['playPause', 'chat', 'next', 'prev', 'search', 'fullscreen', 'queue', 'escape']

export function ShortcutsSection() {
  const shortcuts = useShortcutStore((s) => s.shortcuts)
  const setShortcut = useShortcutStore((s) => s.setShortcut)
  const resetShortcuts = useShortcutStore((s) => s.resetShortcuts)
  const [editing, setEditing] = useState<ShortcutAction | null>(null)

  useEffect(() => {
    if (!editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setShortcut(editing, event.key)
      setEditing(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [editing, setShortcut])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">快捷键</h3>
          <Button variant="ghost" size="sm" onClick={resetShortcuts}>
            恢复默认
          </Button>
        </div>
        <Separator className="mt-2 mb-4" />
        <div className="space-y-2">
          {ORDER.map((action) => (
            <button
              type="button"
              key={action}
              className="hover:bg-muted/50 flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left transition-colors"
              onClick={() => setEditing(action)}
            >
              <span className="text-sm text-muted-foreground">{SHORTCUT_LABELS[action]}</span>
              <kbd className="rounded border bg-muted px-2 py-1 text-xs font-medium text-foreground shadow-sm">
                {editing === action ? '按下按键...' : formatShortcutKey(shortcuts[action] || DEFAULT_SHORTCUTS[action])}
              </kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
