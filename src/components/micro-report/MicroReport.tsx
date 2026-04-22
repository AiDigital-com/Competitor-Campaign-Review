import { useMemo } from 'react';
import { PrintLayout } from '@AiDigital-com/design-system';
import type { SupabaseClient } from '@AiDigital-com/design-system';
import { App as ReportApp } from './report-redesign/App';
import { normalize } from './report-redesign/data';
import type { RawCcrReportData } from './report-redesign/types';
import type { CcrReportData } from '../../lib/types';
import './report-redesign/styles/index.css';

interface Props {
  data: CcrReportData;
  jobId: string;
  onBack?: () => void;
  supabase?: SupabaseClient | null;
  /** true when viewing via share link (no auth) */
  isPublic?: boolean;
  /** true when rendered inside the app widget (owner viewing from chrome) */
  isEmbedded?: boolean;
  /** true when rendering for PDF — all variants stacked in PrintLayout */
  isPrintMode?: boolean;

  /** Visual/Markdown format toggle state. */
  format?: 'visual' | 'markdown';
  onFormatChange?: (f: 'visual' | 'markdown') => void;
  /** Markdown text for DS DownloadBar. When provided, Markdown + PDF buttons render. */
  reportText?: string;
  /** Title used in downloaded filename. */
  downloadTitle?: string;
  /** "+ New scan" callback. */
  onNewScan?: () => void;
}

/**
 * Bridge between CCR's app surfaces (App, PublicReportPage) and the React
 * port at `report-redesign/`.
 *
 * Assembles the DS `ReportTopbar` structured configs from the flat props
 * above so App.tsx doesn't duplicate sharing / download / new-session
 * controls in a second bar.
 */
export function MicroReport({
  data,
  jobId,
  supabase,
  isPublic = false,
  isEmbedded: _isEmbedded = false,
  isPrintMode = false,
  format,
  onFormatChange,
  reportText,
  downloadTitle,
  onNewScan,
}: Props) {
  const ccrData = useMemo(
    () =>
      normalize(
        data as unknown as RawCcrReportData,
        (data as unknown as { generatedAt?: string }).generatedAt,
      ),
    [data],
  );

  // Embedded (owner viewing from inside CCR chrome) is still `interactive` —
  // only share-link visitors get the `public` mode + non-interactive pill.
  const mode: 'interactive' | 'public' | 'print' = isPrintMode
    ? 'print'
    : isPublic
    ? 'public'
    : 'interactive';

  function handleFeedbackSubmit(payload: {
    pageKey: string;
    pageLabel: string;
    rating: number;
    note: string;
  }) {
    fetch('/.netlify/functions/save-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: jobId,
        app: 'competitor-campaign-review',
        jobId,
        score: payload.rating,
        feedbackText: payload.note,
        outputText: payload.pageLabel,
        inputSnapshot: {
          pageKey: payload.pageKey,
          brand_domain: ccrData.overall.brandDomain,
          brand_host: ccrData.overall.brandHost,
        },
      }),
    }).catch(() => {
      /* non-fatal */
    });
  }
  // Suppress the unused-warning until feedback is wired into views.
  void handleFeedbackSubmit;

  if (isPrintMode) {
    return (
      <PrintLayout>
        <ReportApp data={ccrData} mode="print" />
      </PrintLayout>
    );
  }

  const sharing =
    mode === 'interactive' && supabase
      ? { jobId, supabase, tableName: 'ccr_sessions' as const }
      : undefined;

  const download =
    reportText && mode === 'interactive'
      ? {
          reportText,
          title:
            downloadTitle || ccrData.overall.brandHost || 'Competitor Campaign Review',
          visualSelector: '.report-main',
        }
      : undefined;

  return (
    <ReportApp
      data={ccrData}
      mode={mode}
      format={format}
      onFormatChange={onFormatChange}
      download={download}
      onNewSession={mode === 'interactive' ? onNewScan : undefined}
      newSessionLabel="+ New scan"
      sharing={sharing}
    />
  );
}
