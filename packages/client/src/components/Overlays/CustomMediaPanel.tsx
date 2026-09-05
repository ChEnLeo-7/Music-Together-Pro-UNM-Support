import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/lib/i18n'
import { isServerAssetUrl, resolveServerAssetUrl, SERVER_URL } from '@/lib/config'
import { useRoomStore } from '@/stores/roomStore'
import type { Track } from '@music-together/shared'
import {
  ArrowUpToLine,
  CheckCircle2,
  Cookie,
  FileAudio,
  FileUp,
  Link,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { toast } from 'sonner'

interface CustomMediaPanelProps {
  onAddTrack: (track: Track) => void
  onInsertAfterCurrent: (track: Track) => void
}

interface MediaConfig {
  maxUploadBytes: number
  maxDurationSeconds: number
}

type VideoPlatform = 'youtube' | 'bilibili'

interface CookieStatus {
  youtube: boolean
  bilibili: boolean
  sources?: Record<VideoPlatform, 'room' | 'environment' | null>
}

const ACCEPTED_AUDIO = '.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,audio/*'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return new Error(body?.error || `Request failed: ${response.status}`)
}

function uploadMultipart(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<{ track?: Track }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.withCredentials = true
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new Error('Network request failed'))
    request.onabort = () => reject(new Error('Upload cancelled'))
    request.onload = () => {
      let body: { track?: Track; error?: string } | null = null
      try {
        body = request.responseText ? (JSON.parse(request.responseText) as { track?: Track; error?: string }) : null
      } catch {
        body = null
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(body ?? {})
      } else {
        reject(new Error(body?.error || `Request failed: ${request.status}`))
      }
    }
    request.send(formData)
  })
}

export function CustomMediaPanel({ onAddTrack, onInsertAfterCurrent }: CustomMediaPanelProps) {
  const t = useI18n((s) => s.t)
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const roomId = room?.id
  const isOwner = currentUser?.role === 'owner'
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [url, setUrl] = useState('')
  const [mediaTab, setMediaTab] = useState<'file' | 'url'>('file')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [importedTrack, setImportedTrack] = useState<Track | null>(null)
  const [config, setConfig] = useState<MediaConfig | null>(null)
  const [cookieStatus, setCookieStatus] = useState<CookieStatus>({ youtube: false, bilibili: false })
  const [cookieBusy, setCookieBusy] = useState<VideoPlatform | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [cookieDrafts, setCookieDrafts] = useState<Record<VideoPlatform, string>>({ youtube: '', bilibili: '' })

  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    Promise.all([
      fetch(`${SERVER_URL}/api/media/config`, { credentials: 'include' }).then(async (response) => {
        if (!response.ok) throw await responseError(response)
        return (await response.json()) as MediaConfig
      }),
      fetch(`${SERVER_URL}/api/media/rooms/${encodeURIComponent(roomId)}/cookies`, { credentials: 'include' }).then(
        async (response) => {
          if (!response.ok) throw await responseError(response)
          return (await response.json()) as CookieStatus
        },
      ),
    ])
      .then(([mediaConfig, cookies]) => {
        if (cancelled) return
        setConfig(mediaConfig)
        setCookieStatus(cookies)
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  const chooseFile = useCallback((file: File | undefined) => {
    if (!file) return
    setSelectedFile(file)
    setImportedTrack(null)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault()
      setDragging(false)
      chooseFile(event.dataTransfer.files[0])
    },
    [chooseFile],
  )

  const submitFile = useCallback(async () => {
    if (!roomId || !selectedFile || busy) return
    if (config && selectedFile.size > config.maxUploadBytes) {
      toast.error(t('customMediaTooLarge', { size: formatBytes(config.maxUploadBytes) }))
      return
    }
    setBusy(true)
    setProgress(0)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      if (title.trim()) formData.append('title', title.trim())
      if (artist.trim()) formData.append('artist', artist.trim())
      if (album.trim()) formData.append('album', album.trim())
      const result = await uploadMultipart(
        `${SERVER_URL}/api/media/rooms/${encodeURIComponent(roomId)}/upload`,
        formData,
        setProgress,
      )
      if (!result.track) throw new Error(t('customMediaNoTrack'))
      setImportedTrack(result.track)
      toast.success(t('customMediaReady'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('customMediaFailed'))
    } finally {
      setBusy(false)
    }
  }, [album, artist, busy, config, roomId, selectedFile, t, title])

  const submitUrl = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!roomId || !url.trim() || busy) return
      setBusy(true)
      setProgress(0)
      try {
        const response = await fetch(`${SERVER_URL}/api/media/rooms/${encodeURIComponent(roomId)}/import`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url.trim(),
            title: title.trim() || undefined,
            artist: artist.trim() || undefined,
            album: album.trim() || undefined,
          }),
        })
        if (!response.ok) throw await responseError(response)
        const result = (await response.json()) as { track?: Track }
        if (!result.track) throw new Error(t('customMediaNoTrack'))
        setImportedTrack(result.track)
        toast.success(t('customMediaReady'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('customMediaFailed'))
      } finally {
        setBusy(false)
      }
    },
    [album, artist, busy, roomId, t, title, url],
  )

  const saveCookie = useCallback(
    async (platform: VideoPlatform) => {
      const cookie = cookieDrafts[platform].trim()
      if (!roomId || !cookie || !isOwner) return
      setCookieBusy(platform)
      try {
        const response = await fetch(
          `${SERVER_URL}/api/media/rooms/${encodeURIComponent(roomId)}/cookies/${platform}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookie }),
          },
        )
        if (!response.ok) throw await responseError(response)
        setCookieStatus((current) => ({
          ...current,
          [platform]: true,
          sources: {
            youtube: current.sources?.youtube ?? null,
            bilibili: current.sources?.bilibili ?? null,
            [platform]: 'room',
          },
        }))
        setCookieDrafts((current) => ({ ...current, [platform]: '' }))
        toast.success(t('customMediaCookieSaved'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('customMediaFailed'))
      } finally {
        setCookieBusy(null)
      }
    },
    [cookieDrafts, isOwner, roomId, t],
  )

  const removeCookie = useCallback(
    async (platform: VideoPlatform) => {
      if (!roomId || !isOwner) return
      setCookieBusy(platform)
      try {
        const response = await fetch(
          `${SERVER_URL}/api/media/rooms/${encodeURIComponent(roomId)}/cookies/${platform}`,
          {
            method: 'DELETE',
            credentials: 'include',
          },
        )
        if (!response.ok) throw await responseError(response)
        const responseStatus = await fetch(`${SERVER_URL}/api/media/rooms/${encodeURIComponent(roomId)}/cookies`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!responseStatus.ok) throw await responseError(responseStatus)
        setCookieStatus((await responseStatus.json()) as CookieStatus)
        toast.success(t('customMediaCookieRemoved'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('customMediaFailed'))
      } finally {
        setCookieBusy(null)
      }
    },
    [isOwner, roomId, t],
  )

  const addImportedTrack = useCallback(
    (insert: boolean) => {
      if (!importedTrack) return
      if (insert) onInsertAfterCurrent(importedTrack)
      else onAddTrack(importedTrack)
    },
    [importedTrack, onAddTrack, onInsertAfterCurrent],
  )

  if (!roomId) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
          <FileAudio className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{t('customMediaTitle')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('customMediaDescription')}</p>
        </div>
      </div>

      <Tabs value={mediaTab} onValueChange={(value) => setMediaTab(value as 'file' | 'url')} className="min-h-0">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="file" className="gap-1.5 text-xs sm:text-sm">
            <FileUp className="h-3.5 w-3.5" />
            {t('customMediaFileTab')}
          </TabsTrigger>
          <TabsTrigger value="url" className="gap-1.5 text-xs sm:text-sm">
            <Link className="h-3.5 w-3.5" />
            {t('customMediaUrlTab')}
          </TabsTrigger>
        </TabsList>

        <div className="mt-4 space-y-4">
          <TabsContent value="file" className="mt-0 space-y-4">
            <button
              type="button"
              className={`flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
                dragging
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-border hover:border-violet-500/60 hover:bg-muted/40'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              aria-label={t('customMediaChooseFile')}
            >
              <UploadCloud className="h-7 w-7 text-violet-500" />
              <span className="text-sm font-medium">
                {selectedFile ? selectedFile.name : t('customMediaChooseFile')}
              </span>
              <span className="text-xs text-muted-foreground">
                {config
                  ? t('customMediaFileHint', { size: formatBytes(config.maxUploadBytes) })
                  : t('customMediaFileTypes')}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AUDIO}
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </TabsContent>

          <TabsContent value="url" className="mt-0 space-y-4">
            <form className="space-y-3" onSubmit={submitUrl}>
              <Label htmlFor="custom-media-url">{t('customMediaUrlLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="custom-media-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={t('customMediaUrlPlaceholder')}
                  disabled={busy}
                  required
                />
                <Button type="submit" disabled={busy || !url.trim()} aria-label={t('customMediaImport')}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
                  <span className="hidden sm:inline">{t('customMediaImport')}</span>
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('customMediaUrlHint')}</p>
            </form>
          </TabsContent>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="custom-media-title">{t('customMediaTitleLabel')}</Label>
              <Input
                id="custom-media-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('customMediaOptional')}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-media-artist">{t('customMediaArtistLabel')}</Label>
              <Input
                id="custom-media-artist"
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                placeholder={t('customMediaOptional')}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="custom-media-album">{t('customMediaAlbumLabel')}</Label>
              <Input
                id="custom-media-album"
                value={album}
                onChange={(event) => setAlbum(event.target.value)}
                placeholder={t('customMediaOptional')}
                disabled={busy}
              />
            </div>
          </div>

          {mediaTab === 'file' && selectedFile && (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileAudio className="h-4 w-4 shrink-0 text-violet-500" />
                <span className="truncate text-xs">{selectedFile.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</span>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSelectedFile(null)}
                disabled={busy}
                aria-label={t('clear')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {mediaTab === 'file' && (
            <Button className="w-full" onClick={submitFile} disabled={busy || !selectedFile}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {busy ? t('customMediaProcessing') : t('customMediaUpload')}
            </Button>
          )}

          {mediaTab === 'file' && busy && (
            <div className="space-y-1.5" role="status" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-violet-500 transition-[width]"
                  style={{ width: `${Math.max(progress, 4)}%` }}
                />
              </div>
              <p className="text-right text-[11px] text-muted-foreground">{progress}%</p>
            </div>
          )}

          {importedTrack && (
            <div className="space-y-3 rounded-xl border bg-card/60 p-3">
              <div className="flex min-w-0 items-center gap-3">
                {importedTrack.cover ? (
                  <img
                    src={resolveServerAssetUrl(importedTrack.cover)}
                    crossOrigin={isServerAssetUrl(importedTrack.cover) ? 'use-credentials' : undefined}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                    <FileAudio className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{importedTrack.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {importedTrack.artist.join(' / ')}
                    {importedTrack.album ? ` · ${importedTrack.album}` : ''}
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => addImportedTrack(false)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('addToQueue')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => addImportedTrack(true)}>
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                  {t('insertNext')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Tabs>

      {mediaTab === 'url' && (
        <div className="mt-5 border-t pt-4">
          <div className="mb-3 flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{t('customMediaCookiesTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t(isOwner ? 'customMediaCookiesOwnerHint' : 'customMediaCookiesMemberHint')}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['youtube', 'bilibili'] as const).map((platform) => (
              <div key={platform} className="space-y-2 rounded-lg border px-3 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Cookie className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium">{t(platform === 'youtube' ? 'youtube' : 'bilibili')}</span>
                    <span
                      className={`text-[10px] ${cookieStatus[platform] ? 'text-emerald-500' : 'text-muted-foreground'}`}
                    >
                      {cookieStatus.sources?.[platform] === 'environment'
                        ? t('customMediaCookieEnvironment')
                        : cookieStatus[platform]
                          ? t('customMediaCookieConfigured')
                          : t('customMediaCookieNotConfigured')}
                    </span>
                  </div>
                  {isOwner && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={cookieBusy !== null || !cookieDrafts[platform].trim()}
                        onClick={() => void saveCookie(platform)}
                        aria-label={t('customMediaSaveCookie')}
                      >
                        {cookieBusy === platform ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {cookieStatus.sources?.[platform] === 'room' && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={cookieBusy !== null}
                          onClick={() => void removeCookie(platform)}
                          aria-label={t('customMediaRemoveCookie')}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {isOwner && (
                  <textarea
                    className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-20 w-full resize-y rounded-md border px-3 py-2 text-xs focus-visible:ring-1 focus-visible:outline-none"
                    value={cookieDrafts[platform]}
                    onChange={(event) => setCookieDrafts((current) => ({ ...current, [platform]: event.target.value }))}
                    placeholder={t('customMediaCookiePlaceholder')}
                    disabled={cookieBusy !== null}
                    aria-label={t('customMediaCookieInput', { platform: t(platform) })}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
