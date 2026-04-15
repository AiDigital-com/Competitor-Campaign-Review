/**
 * CcrReport — competitor campaign intelligence report.
 * Uses DS components: PageHeader, ReportTable, SectionDivider, AssetPreview.
 */
import { useState, useEffect } from 'react';
import {
  PageHeader,
  ReportTable,
  SectionDivider,
  AssetPreview,
  StatusBadge,
} from '@AiDigital-com/design-system';
import { renderMarkdown } from '@AiDigital-com/design-system/utils';
import type { CcrReportData, CampaignData } from '../lib/types';

interface Props {
  data: CcrReportData;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('_video.');
}

export function CcrReport({ data }: Props) {
  const [narrativeHtml, setNarrativeHtml] = useState('');

  useEffect(() => {
    if (data.narrative) {
      renderMarkdown(data.narrative).then(setNarrativeHtml);
    }
  }, [data.narrative]);

  const allDomains = [data.brand, ...(data.competitors || [])];

  return (
    <div className="ccr-report">
      <PageHeader
        title={`Campaign Intelligence: ${data.brand.domain}`}
        subtitle={`Compared against ${(data.competitors || []).length} competitor${(data.competitors || []).length !== 1 ? 's' : ''} · ${formatDate(data.generatedAt)}`}
        meta={<StatusBadge status="complete" label="Analysis Complete" />}
      />

      {/* ── Comparison Table (brand + competitors) ─────────────────── */}
      <SectionDivider label="Campaign Comparison" />
      <ReportTable<CampaignData>
        columns={[
          { key: 'domain', header: 'Advertiser', render: r =>
            r.domain === data.brand.domain
              ? <><strong>{r.domain}</strong> <StatusBadge status="info" label="Brand" /></>
              : r.domain
          },
          { key: 'impressions', header: 'Impressions', render: r => fmtNumber(r.totalImpressions), align: 'right' },
          { key: 'spend', header: 'Est. Spend', render: r => `$${fmtMoney(r.totalSpend)}`, align: 'right' },
          { key: 'cpm', header: 'CPM', render: r => r.totalImpressions > 0 ? `$${((r.totalSpend / r.totalImpressions) * 1000).toFixed(2)}` : '—', align: 'right' },
          { key: 'channels', header: 'Channels', render: r => (r.channels || []).map(c => c.name).join(', ') || '—' },
          { key: 'sov', header: 'SOV', render: r => {
            const totalImps = allDomains.reduce((s, d) => s + d.totalImpressions, 0) || 1;
            return `${((r.totalImpressions / totalImps) * 100).toFixed(1)}%`;
          }, align: 'right' },
        ]}
        rows={allDomains}
        getKey={r => r.domain}
      />

      {/* ── Creatives ─────────────────────────────────────────────── */}
      {allDomains.some(d => (d.creatives || []).length > 0) && (
        <>
          <SectionDivider label="Ad Creatives" />
          {allDomains.map(comp => {
            const creatives = (comp.creatives || []).filter(c => c.url);
            if (creatives.length === 0) return null;
            const label = comp.domain === data.brand.domain ? `${comp.domain} (Brand)` : comp.domain;
            return (
              <div key={comp.domain} style={{ marginBottom: '1rem' }}>
                <h4 style={{ color: 'var(--text)', margin: '0 0 0.5rem', fontSize: '0.875rem' }}>{label}</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {creatives.slice(0, 6).map(c => (
                    <AssetPreview
                      key={c.id}
                      type={isVideoUrl(c.url) ? 'url' : 'image'}
                      url={c.url}
                      label={isVideoUrl(c.url) ? 'Video Ad' : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── Strategic Analysis ────────────────────────────────────── */}
      {narrativeHtml && (
        <>
          <SectionDivider label="Strategic Analysis" />
          <div className="aidl-report-viewer">
            <div className="aidl-report-content" dangerouslySetInnerHTML={{ __html: narrativeHtml }} />
          </div>
        </>
      )}
    </div>
  );
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
    });
  } catch {
    return iso;
  }
}
