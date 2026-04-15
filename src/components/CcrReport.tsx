/**
 * CcrReport — competitor campaign intelligence report.
 * Uses DS components: PageHeader, KpiTile, ReportTable, SectionDivider, AssetPreview.
 * No custom CSS — all styling via DS component classes.
 */
import { useState, useEffect } from 'react';
import {
  PageHeader,
  KpiTile,
  ReportTable,
  SectionDivider,
  AssetPreview,
  StatusBadge,
} from '@AiDigital-com/design-system';
import { renderMarkdown } from '@AiDigital-com/design-system/utils';
import type { CcrReportData, CampaignData, ChannelData } from '../lib/types';

interface Props {
  data: CcrReportData;
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
        meta={
          <StatusBadge status="complete" label="Analysis Complete" />
        }
      />

      {/* ── Brand KPIs ─────────────────────────────────────────────── */}
      <SectionDivider label="Your Brand" />
      <div className="aidl-kpi-row">
        <KpiTile label="Total Impressions" value={fmtNumber(data.brand.totalImpressions)} />
        <KpiTile label="Estimated Spend" value={`$${fmtMoney(data.brand.totalSpend)}`} />
        <KpiTile
          label="CPM"
          value={data.brand.totalImpressions > 0
            ? `$${((data.brand.totalSpend / data.brand.totalImpressions) * 1000).toFixed(2)}`
            : 'N/A'}
        />
        <KpiTile label="Publishers" value={String((data.brand as any).distinct_publishers || (data.brand.publishers || []).length || '—')} />
        <KpiTile label="Creatives" value={String((data.brand as any).distinct_creatives || (data.brand.creatives || []).length || '—')} />
      </div>

      {/* ── Brand Channels ────────────────────────────────────────── */}
      {(data.brand.channels || []).length > 0 && (
        <ReportTable<ChannelData>
          columns={[
            { key: 'name', header: 'Channel', render: r => r.name },
            { key: 'impressions', header: 'Impressions', render: r => fmtNumber(r.impressions), align: 'right' },
            { key: 'spend', header: 'Est. Spend', render: r => `$${fmtMoney(r.spend)}`, align: 'right' },
            { key: 'share', header: 'Share', render: r => {
              const total = data.brand.totalImpressions || 1;
              return `${((r.impressions / total) * 100).toFixed(1)}%`;
            }, align: 'right' },
          ]}
          rows={data.brand.channels || []}
          getKey={r => r.name}
        />
      )}

      {/* ── Brand Creatives ───────────────────────────────────────── */}
      {(data.brand.creatives || []).length > 0 && (
        <>
          <SectionDivider label="Brand Creatives" />
          <div className="aidl-kpi-row">
            {(data.brand.creatives || []).slice(0, 6).map(c =>
              c.url ? (
                <AssetPreview
                  key={c.id}
                  type="image"
                  url={c.url}
                  label={c.channelName || undefined}
                />
              ) : null
            )}
          </div>
        </>
      )}

      {/* ── Competitor Comparison Table ────────────────────────────── */}
      <SectionDivider label="Competitor Comparison" />
      <ReportTable<CampaignData>
        columns={[
          { key: 'domain', header: 'Advertiser', render: r => r.domain },
          { key: 'impressions', header: 'Impressions', render: r => fmtNumber(r.totalImpressions), align: 'right' },
          { key: 'spend', header: 'Est. Spend', render: r => `$${fmtMoney(r.totalSpend)}`, align: 'right' },
          { key: 'cpm', header: 'CPM', render: r => r.totalImpressions > 0 ? `$${((r.totalSpend / r.totalImpressions) * 1000).toFixed(2)}` : '—', align: 'right' },
          { key: 'channels', header: 'Channels', render: r => (r.channels || []).map(c => c.name).join(', ') || '—' },
        ]}
        rows={allDomains}
        getKey={r => r.domain}
      />

      {/* ── Per-Competitor Creative Previews ───────────────────────── */}
      {(data.competitors || []).filter(c => (c.creatives || []).length > 0).length > 0 && (
        <>
          <SectionDivider label="Competitor Creatives" />
          {(data.competitors || []).map(comp => {
            const creatives = (comp.creatives || []).filter(c => c.url);
            if (creatives.length === 0) return null;
            return (
              <div key={comp.domain} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: 'var(--text)', margin: '0 0 0.5rem', fontSize: '0.875rem' }}>{comp.domain}</h4>
                <div className="aidl-kpi-row">
                  {creatives.slice(0, 4).map(c => (
                    <AssetPreview key={c.id} type="image" url={c.url} label={c.channelName || undefined} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── Strategic Analysis (LLM Narrative) ────────────────────── */}
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

// ── Formatting ──────────────────────────────────────────────────────────────

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
