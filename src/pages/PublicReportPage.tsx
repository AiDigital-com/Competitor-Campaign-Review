/**
 * Public report page — renders at /r/:share_token
 * No Clerk auth required. Queries ccr_sessions by share_token + is_public.
 */
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { downloadVisualPDF } from '@AiDigital-com/design-system/utils';
import { CcrReport } from '../components/CcrReport';
import type { CcrReportData } from '../lib/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function PublicReportPage() {
  const token = window.location.pathname.replace(/^\/r\//, '').split('/')[0];
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportData, setReportData] = useState<CcrReportData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const autoPdfTriggered = useRef(false);

  useEffect(() => {
    if (!token) { setState('error'); setErrorMsg('Invalid report link.'); return; }
    if (!supabaseUrl || !supabaseAnonKey) { setState('error'); setErrorMsg('Configuration error.'); return; }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    supabase
      .from('ccr_sessions')
      .select('report_data')
      .eq('share_token', token)
      .eq('is_public', true)
      .single()
      .then(({ data, error }) => {
        if (error || !data?.report_data) {
          setErrorMsg('This report is private or no longer available.');
          setState('error');
          return;
        }
        setReportData(data.report_data as CcrReportData);
        setState('ready');
      });
  }, [token]);

  // Auto PDF download when ?pdf=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pdf') === '1' && state === 'ready' && !autoPdfTriggered.current) {
      autoPdfTriggered.current = true;
      setTimeout(async () => {
        try {
          await downloadVisualPDF('.ccr-report', 'Competitor Campaign Review');
        } catch (e) {
          console.error('Auto PDF failed:', e);
        }
      }, 2000);
    }
  }, [state]);

  // Add pdf-mode class for PDFShift rendering
  useEffect(() => {
    const isPdf = new URLSearchParams(window.location.search).get('pdf-mode') === '1';
    if (isPdf) document.body.classList.add('aidl-pdf-mode');
    return () => document.body.classList.remove('aidl-pdf-mode');
  }, []);

  // Report height for iframe auto-sizing
  useEffect(() => {
    if (window.parent !== window) {
      const reportHeight = () => {
        window.parent.postMessage({ type: 'aidl-report-height', height: document.body.scrollHeight }, '*');
      };
      reportHeight();
      const observer = new ResizeObserver(reportHeight);
      observer.observe(document.body);
      return () => observer.disconnect();
    }
  }, []);

  if (state === 'loading') {
    return (
      <div className="aidl-auth-gate">
        <div className="aidl-auth-gate__brand">Loading Report...</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="aidl-status-page">
        <div className="aidl-status-page__icon">🔒</div>
        <h2>Report Unavailable</h2>
        <p>{errorMsg}</p>
      </div>
    );
  }

  if (reportData) {
    return (
      <div className="ccr-report-wrapper">
        <CcrReport data={reportData} />
      </div>
    );
  }

  return null;
}
