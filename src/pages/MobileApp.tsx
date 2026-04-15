/**
 * CCR Mobile App — /m route
 * Anonymous, no Clerk auth. Phase state machine.
 * Same N-Lambda pipeline backend, simplified mobile report.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { BrandMark, ThemeToggle, ProgressBar } from '@AiDigital-com/design-system'
import { MobileIntake } from '../components/mobile/MobileIntake'
import { MobileReport } from '../components/mobile/MobileReport'
import '../ccr-mobile.css'

type Phase = 'intake' | 'processing' | 'report_ready' | 'error'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export default function MobileApp() {
  const [phase, setPhase] = useState<Phase>('intake')
  const [jobId, setJobId] = useState<string | null>(null)
  const [reportData, setReportData] = useState<Record<string, any> | null>(null)
  const [progressStep, setProgressStep] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const supabaseRef = useRef(createClient(supabaseUrl, supabaseAnonKey))

  // Submit brand domain → dispatch pipeline
  const handleSubmit = useCallback(async (brandDomain: string) => {
    setPhase('processing')
    setProgressStep('Discovering competitors…')
    setError(null)

    try {
      const sessionId = crypto.randomUUID()
      setJobId(sessionId)

      const res = await fetch('/.netlify/functions/mobile-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: sessionId,
          intakeSummary: { brand_domain: brandDomain, source: 'url', brand_name: brandDomain },
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Dispatch failed' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start analysis')
      setPhase('error')
    }
  }, [])

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

    // Initial fetch
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
