import { lazy, Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { SocketProvider } from '@/providers/SocketProvider'
import HomePage from '@/pages/HomePage'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AnimatePresence } from 'motion/react'
import { AlertTriangle } from 'lucide-react'
import { PasswordChangeGate } from '@/components/PasswordChangeGate'
import { useI18n } from '@/lib/i18n'

// Lazy-loaded routes (keep HomePage sync for fast first paint)
const RoomPage = lazy(() => import('@/pages/RoomPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function ErrorFallback({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) {
  const t = useI18n((s) => s.t)
  const showDiagnostics = import.meta.env.DEV && import.meta.env.VITE_SHOW_ERROR_DETAILS === 'true'
  const diagnostic = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-lg">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">{t('unexpectedErrorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('unexpectedError')}</p>
        {showDiagnostics && <pre className="max-w-full overflow-auto text-left text-xs text-muted-foreground">{diagnostic}</pre>}
        <Button onClick={resetErrorBoundary} variant="default">
          {t('retry')}
        </Button>
      </div>
    </div>
  )
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

/** Route-level ErrorBoundary: navigates home on reset instead of full reload */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => navigate('/', { replace: true })}>
      {children}
    </ErrorBoundary>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <RouteErrorBoundary>
                <HomePage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/room/:roomId"
            element={
              <RouteErrorBoundary>
                <RoomPage />
              </RouteErrorBoundary>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SocketProvider>
        <TooltipProvider>
          <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
            <AnimatedRoutes />
            <PasswordChangeGate />
          </ErrorBoundary>
          <Toaster position="top-center" richColors />
        </TooltipProvider>
      </SocketProvider>
    </BrowserRouter>
  )
}
