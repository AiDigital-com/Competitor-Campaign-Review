/**
 * CCR Mobile App — /m route
 * Anonymous, no Clerk auth. Phase state machine.
 * Campaign gating via ?c=<slug> param.
 * Same N-Lambda pipeline backend, simplified mobile report.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { BrandMark, ThemeToggle, ProgressBar } from '@AiDigital-com/design-system'
import { MobileIntake } from '../components/mobile/MobileIntake'
import { MobileReport } from '../components/mobile/MobileReport'
import '../ccr-mobile.css'

type Phase = 'loading' | 'campaign_gate' | 'intake' | 'processing' | 'report_ready' | 'error'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export default function MobileApp() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [jobId, setJobId] = useState<string | null>(null)
  const [reportData, setReportData] = useState<Record<string, any> | null>(null)
  const [progressStep, setProgressStep] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [campaignSlug, setCampaignSlug] = useState<string | null>(null)
  const [campaignGateMessage, setCampaignGateMessage] = useState<string | null>(null)
  const supabaseRef = useRef(createClient(supabaseUrl, supabaseAnonKey))

  // Check campaign slug on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const slug = params.get('c')

    if (!slug) {
      setPhase('intake')
      return
    }

    setCampaignSlug(slug)
    fetch(`/.netlify/functions/mobile-check-campaign?c=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setPhase('intake')
        } else {
          setCampaignGateMessage(
            data.ended_message ||
            (data.reason === 'limit_reached' ? 'This campaign has reached its usage limit.' :
             data.reason === 'campaign_ended' ? 'This campaign has ended.' :
             data.reason === 'not_started' ? 'This campaign has not started yet.' :
             data.reason === 'campaign_inactive' ? 'This campaign is currently inactive.' :
             'Campaign not available.')
          )
          setPhase('campaign_gate')
        }
      })
      .catch(() => {
        setPhase('intake') // Proceed without campaign gating on check failure
      })
  }, [])

  // Submit: mobile orchestrator resolves brand → dispatch pipeline
  const handleSubmit = useCallback(async (userInput: string) => {
    setPhase('processing')
    setProgressStep('Resolving brand…')
    setError(null)

    try {
      // Step 1: Resolve brand input → domain via mobile orchestrator
      const resolveRes = await fetch('/.netlify/functions/mobile-orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mobile-Source': 'ccr-mobile' },
        body: JSON.stringify({ userInput }),
      })

      if (!resolveRes.ok) {
        const err = await resolveRes.json().catch(() => ({ error: 'Resolution failed' }))
        throw new Error(err.error || `Could not resolve brand`)
      }

      const { brand_domain } = await resolveRes.json()
      if (!brand_domain) throw new Error('Could not resolve brand domain')

      // Step 2: Dispatch pipeline with resolved domain
      setProgressStep('Discovering competitors…')
      const sessionId = crypto.randomUUID()
      setJobId(sessionId)

      const dispatchRes = await fetch('/.netlify/functions/mobile-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: sessionId,
          intakeSummary: { brand_domain, source: 'url', brand_name: brand_domain },
          ...(campaignSlug ? { campaignSlug } : {}),
        }),
      })

      // 504 = kick timeout, pipeline still started
      if (!dispatchRes.ok && dispatchRes.status !== 504) {
        const err = await dispatchRes.json().catch(() => ({ error: 'Dispatch failed' }))
        if (dispatchRes.status === 429) {
          setCampaignGateMessage(err.ended_message || 'Campaign usage limit reached.')
          setPhase('campaign_gate')
          return
        }
        throw new Error(err.error || `HTTP ${dispatchRes.status}`)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start analysis')
      setPhase('error')
    }
  }, [campaignSlug])

  // Subscribe to job_status for progress steps
  useEffect(() => {
    if (!jobId) return
    const sb = supabaseRef.current

    const channel = sb.channel(`ccr-mobile-job-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'job_status',
        filter: `id=eq.${jobId}`,
      }, (payload: any) => {
        const row = payload.new
        if (row.meta?.current_step) setProgressStep(row.meta.current_step)
        if (row.status === 'error') {
          setError(row.error || 'Pipeline failed')
          setPhase('error')
        }
      })
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [jobId])

  // Subscribe to ccr_sessions.report_data for progressive rendering
  useEffect(() => {
    if (!jobId) return
    const sb = supabaseRef.current

    sb.from('ccr_sessions').select('report_data, status')
      .eq('id', jobId).single()
      .then(({ data }) => {
        if (data?.report_data) {
          setReportData(data.report_data)
          if (data.report_data.phase === 'complete') setPhase('report_ready')
        }
        if (data?.status === 'error') {
          setError('Pipeline failed')
          setPhase('error')
        }
      })

    const channel = sb.channel(`ccr-mobile-report-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'ccr_sessions',
        filter: `id=eq.${jobId}`,
      }, (payload: any) => {
        const row = payload.new
        if (row.report_data) {
          setReportData(row.report_data)
          if (row.report_data.phase === 'complete') setPhase('report_ready')
        }
        if (row.status === 'error') {
          setError('Pipeline failed')
          setPhase('error')
        }
      })
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [jobId])

  // Defensive refetch on progress step changes
  useEffect(() => {
    if (!jobId || !progressStep) return
    supabaseRef.current.from('ccr_sessions').select('report_data')
      .eq('id', jobId).single()
      .then(({ data }) => {
        if (data?.report_data) {
          setReportData(data.report_data)
          if (data.report_data.phase === 'complete') setPhase('report_ready')
        }
      })
  }, [jobId, progressStep])

  return (
    <div className="ccr-m-app">
      <header className="ccr-m-header">
        <div className="ccr-m-header-left">
          <BrandMark size={28} />
          <span className="ccr-m-header-title">Campaign Intelligence</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="ccr-m-main">
        {phase === 'loading' && (
          <div className="ccr-m-loading">
            <ProgressBar />
          </div>
        )}

        {phase === 'campaign_gate' && (
          <div className="ccr-m-gate">
            <p>{campaignGateMessage}</p>
          </div>
        )}

        {phase === 'intake' && (
          <MobileIntake onSubmit={handleSubmit} />
        )}

        {(phase === 'processing' || phase === 'report_ready') && (
          <>
            {phase === 'processing' && (
              <div className="ccr-m-progress">
                <ProgressBar value={reportData?.phase === 'complete' ? 100 : undefined} />
                <span className="ccr-m-progress-label">{progressStep || 'Starting analysis…'}</span>
              </div>
            )}
            <MobileReport data={reportData || {}} />
          </>
        )}

        {phase === 'error' && (
          <div className="ccr-m-error">
            <p>{error || 'Something went wrong.'}</p>
            <button className="ccr-m-btn" onClick={() => { setPhase('intake'); setError(null); setJobId(null); setReportData(null) }}>
              Try Again
            </button>
          </div>
        )}
      </main>

      <footer className="ccr-m-footer">
        <span>Powered by AI Digital Labs</span>
      </footer>
    </div>
  )
}
