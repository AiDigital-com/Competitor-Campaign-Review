/**
 * Competitor Campaign Review (CCR)
 *
 * Flow:
 * 1. User uploads image or types a URL in chat.
 * 2. Orchestrator identifies the brand domain and dispatches.
 * 3. ccr-pipeline-background runs (DataForSeo → BigQuery → Firecrawl → LLM).
 * 4. Frontend watches job_status via useJobStatus (Realtime).
 * 5. On complete, CcrReport renders the side-by-side comparison.
 */
import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  AppShell,
  ChatPanel,
  Sidebar,
  UploadZone,
  ConnectedShareBar,
  DownloadBar,
  useOrchestrator,
  useFileUpload,
  useJobStatus,
  useSessionPersistence,
} from '@AiDigital-com/design-system'
import type { SupabaseClient, SidebarItem } from '@AiDigital-com/design-system'
import { createClient } from '@supabase/supabase-js'
import { SignIn, UserButton, useAuth } from '@clerk/react'
import { CcrReport } from './components/CcrReport'
import type { CcrReportData, CcrIntake } from './lib/types'
import './App.css'

// ── App Config ────────────────────────────────────────────────────────────────
const APP_NAME = 'competitor-campaign-review'
const APP_TITLE = 'Competitor Campaign Review'
const SESSION_TABLE = 'ccr_sessions'
const TITLE_FIELD = 'brand_name'
const ACTIVITY_LABEL = 'Review'

const supabaseConfig = import.meta.env.VITE_SUPABASE_URL ? {
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  createClient: createClient as any,
} : undefined

interface AppSession extends SidebarItem {
  title: string;
}

export default function App() {
  const { userId, getToken } = useAuth()

  const [sidebarItems, setSidebarItems] = useState<AppSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [sidebarSupabase, setSidebarSupabase] = useState<SupabaseClient | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!sidebarSupabase) return
    sidebarSupabase.from(SESSION_TABLE)
      .select(`id, ${TITLE_FIELD}, status, created_at`)
      .eq('deleted_by_user', false)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setSidebarItems((data ?? []).map((r: any) => ({
          id: r.id,
          title: r[TITLE_FIELD] || 'Untitled',
          status: r.status,
          createdAt: r.created_at,
        })))
      })
  }, [refreshKey, sidebarSupabase])

  const handlersRef = useRef<{
    onSelect: (id: string) => void
    onNew: () => void
    onDelete: (id: string) => void
  }>({ onSelect: () => {}, onNew: () => {}, onDelete: () => {} })

  return (
    <AppShell
      appTitle={APP_TITLE}
      activityLabel={ACTIVITY_LABEL}
      auth={{ SignIn, UserButton, useAuth }}
      supabaseConfig={supabaseConfig}
      helpUrl="/help"
      sidebar={
        <Sidebar
          items={sidebarItems}
          activeId={activeSessionId}
          loadingId={loadingId}
          onSelect={(id) => handlersRef.current.onSelect(id)}
          onNew={() => handlersRef.current.onNew()}
          onDelete={(id) => handlersRef.current.onDelete(id)}
          renderItem={(item) => <span>{(item as AppSession).title}</span>}
          newLabel={`+ New ${ACTIVITY_LABEL}`}
          emptyMessage={`No ${ACTIVITY_LABEL.toLowerCase()}s yet.`}
        />
      }
    >
      {({ authFetch, supabase }) => (
        <AppContent
          authFetch={authFetch}
          supabase={supabase}
          userId={userId}
          getToken={getToken}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          setLoadingId={setLoadingId}
          setRefreshKey={setRefreshKey}
          handlersRef={handlersRef}
          setSidebarSupabase={setSidebarSupabase}
        />
      )}
    </AppShell>
  )
}

/* ── Domain-specific content ────────────────────────────────────────────── */

interface AppContentProps {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  supabase: SupabaseClient | null
  userId: string | null | undefined
  getToken: () => Promise<string | null>
  activeSessionId: string | null
  setActiveSessionId: Dispatch<SetStateAction<string | null>>
  setLoadingId: Dispatch<SetStateAction<string | null>>
  setRefreshKey: Dispatch<SetStateAction<number>>
  handlersRef: React.MutableRefObject<{
    onSelect: (id: string) => void
    onNew: () => void
    onDelete: (id: string) => void
  }>
  setSidebarSupabase: Dispatch<SetStateAction<SupabaseClient | null>>
}

function AppContent({
  authFetch, supabase, userId, getToken,
  activeSessionId, setActiveSessionId, setLoadingId, setRefreshKey,
  handlersRef, setSidebarSupabase,
}: AppContentProps) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [reportData, setReportData] = useState<CcrReportData | null>(null)
  const [dispatched, setDispatched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Expose supabase to sidebar
  useEffect(() => { setSidebarSupabase(supabase) }, [supabase, setSidebarSupabase])

  // Session persistence
  const session = useSessionPersistence(supabase, authFetch, userId, {
    table: SESSION_TABLE,
    app: APP_NAME,
    titleField: TITLE_FIELD,
    mergeConfig: { objectFields: ['intake_summary'] },
    defaultFields: { status: 'chatting', deleted_by_user: false },
    mergeEndpoint: '/.netlify/functions/save-session',
    sessionsEndpoint: '/.netlify/functions/get-sessions',
  })

  // Image upload — local base64 only (no Supabase storage needed)
  const imageUpload = useFileUpload<{ base64: string; mimeType: string }>(
    async (file: File) => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      return { base64, mimeType: file.type }
    }
  )

  // Dispatch handler — fires when orchestrator emits 'competitor_dispatch'
  const handleDispatch = useCallback(async (
    data: unknown,
    sessionId: string,
  ) => {
    const intake = data as CcrIntake
    const newJobId = crypto.randomUUID()
    setJobId(newJobId)
    setDispatched(true)
    setActiveSessionId(sessionId)

    // Upsert session record with brand name + job id
    // Uses upsert because useSessionPersistence may not have created the row yet
    if (supabase) {
      await supabase.from(SESSION_TABLE).upsert({
        id: sessionId,
        user_id: userId,
        brand_name: intake.brand_domain,
        status: 'processing',
        job_id: newJobId,
        intake_summary: intake,
        deleted_by_user: false,
      }, { onConflict: 'id' })
    }

    // Insert first pipeline task (N-Lambda architecture)
    // Also create job_status row so frontend can track progress via Realtime
    if (supabase) {
      await supabase.from('job_status').upsert({
        id: newJobId,
        app: APP_NAME,
        status: 'streaming',
        meta: { current_step: 'Discovering competitors…' },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

      await supabase.from('pipeline_tasks').insert({
        scan_id: sessionId,
        app: APP_NAME,
        task_type: 'ccr_discover',
        status: 'pending',
        payload: { sessionId, jobId: newJobId, brandDomain: intake.brand_domain, userId },
        attempts: 0,
        max_attempts: 2,
      })
    }

    // Kick task-worker to pick up immediately
    authFetch('/.netlify/functions/task-worker', { method: 'POST' })
      .catch(() => {})

    setRefreshKey(k => k + 1)
  }, [supabase, userId, authFetch, setActiveSessionId, setRefreshKey])

  // SSE chat orchestrator
  const orchestrator = useOrchestrator(getToken, supabase, handleDispatch, {
    tableName: SESSION_TABLE,
    titleField: TITLE_FIELD,
    dispatchEventType: 'competitor_dispatch',
    dispatchDataKey: 'intakeSummary',
    sessionInsertFields: { status: 'chatting', deleted_by_user: false },
    onSessionCreated: () => setRefreshKey(k => k + 1),
    endpoint: '/.netlify/functions/orchestrator',
  })

  // Watch pipeline progress via Supabase Realtime
  const jobStatus = useJobStatus(supabase, jobId)

  // Parse report when pipeline completes
  useEffect(() => {
    if (jobStatus?.status === 'complete' && jobStatus.report && !reportData) {
      try {
        setReportData(JSON.parse(jobStatus.report))
      } catch (err) {
        console.error('Failed to parse report:', err)
        setError('Failed to parse report data.')
      }
    }
    if (jobStatus?.status === 'error') {
      setError(jobStatus.error ?? 'Pipeline failed. Please try again.')
    }
  }, [jobStatus, reportData])

  // Wire sidebar handlers
  useEffect(() => {
    handlersRef.current = {
      onSelect: async (id: string) => {
        if (!supabase) return
        setLoadingId(id)
        const { data } = await supabase.from(SESSION_TABLE).select('*').eq('id', id).maybeSingle()
        setLoadingId(null)
        if (!data) return
        session.loadSession(id)
        setActiveSessionId(id)
        orchestrator.reset()
        setDispatched(false)
        setJobId(null)
        setReportData(null)
        setError(null)
        // Restore messages if available
        if (data.messages) {
          // Messages are restored via session — orchestrator reset handles state
        }
        // If session has a completed report, show it
        if (data.report_data) {
          setReportData(data.report_data as CcrReportData)
          setDispatched(true)
        } else if (data.job_id && data.status === 'processing') {
          setJobId(data.job_id)
          setDispatched(true)
        }
      },
      onNew: () => {
        orchestrator.reset()
        session.newSession()
        setActiveSessionId(null)
        setDispatched(false)
        setJobId(null)
        setReportData(null)
        setError(null)
        imageUpload.clear()
      },
      onDelete: async (id: string) => {
        session.deleteSession(id)
        setRefreshKey(k => k + 1)
        if (id === activeSessionId) {
          orchestrator.reset()
          setActiveSessionId(null)
          setDispatched(false)
          setJobId(null)
          setReportData(null)
          setError(null)
        }
      },
    }
  }, [supabase, session, orchestrator, imageUpload, activeSessionId, setActiveSessionId, setLoadingId, setRefreshKey])

  // ── Send handler ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string, asset: { base64: string; mimeType: string } | null) => {
    const sendAsset = asset
      ? { imageBase64: asset.base64, imageMimeType: asset.mimeType }
      : undefined
    imageUpload.clear()
    await orchestrator.sendMessage(text, sendAsset)
  }, [orchestrator, imageUpload])

  // ── Progress message ──────────────────────────────────────────────────────
  const progressStep = jobStatus?.meta?.current_step as string | undefined

  return (
    <>
      {/* Phase 1: Chat + Upload (pre-report) */}
      {!reportData && (
        <>
          <ChatPanel
            messages={orchestrator.messages}
            streaming={orchestrator.streaming}
            error={error ?? orchestrator.error}
            onSend={handleSend}
            asset={imageUpload.result}
            inputPrefix={!dispatched ? (
              <UploadZone
                onFile={(file) => imageUpload.upload(file)}
                onUrl={(url) => orchestrator.sendMessage(`Analyze this campaign URL: ${url}`)}
                onClear={imageUpload.clear}
                preview={imageUpload.previewUrl}
                uploading={imageUpload.uploading}
                error={imageUpload.error}
                accept="image/jpeg,image/png,image/webp,image/gif"
                fileLabel="Drop a campaign image or enter a URL"
              />
            ) : undefined}
            welcomeTitle="Competitor Campaign Review"
            welcomeDescription="Analyze competitor campaigns, creative strategies, and messaging. Drop a campaign image or type a brand URL to begin."
            placeholder={
              imageUpload.result
                ? 'Image ready — press enter to analyze…'
                : 'Enter a brand URL or describe the campaign…'
            }
          />

          {/* Pipeline progress */}
          {dispatched && (
            <div className="ccr-progress">
              <div className="ccr-progress__spinner" />
              <p className="ccr-progress__step">
                {progressStep ?? 'Starting analysis…'}
              </p>
            </div>
          )}
        </>
      )}

      {/* Phase 2: Full report with share bar + download */}
      {reportData && (
        <div className="ccr-report-page">
          <div className="ccr-report-bar">
            <DownloadBar
              reportText={reportData.narrative || ''}
              title={`CCR — ${reportData.brand?.domain || 'Report'}`}
              visualSelector=".ccr-report"
            />
            {supabase && activeSessionId && (
              <ConnectedShareBar
                jobId={activeSessionId}
                supabase={supabase}
                tableName={SESSION_TABLE}
              />
            )}
          </div>
          <div className="ccr-report-wrapper">
            <CcrReport data={reportData} />
          </div>
        </div>
      )}
    </>
  )
}
