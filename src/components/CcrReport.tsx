/**
 * CcrReport — competitor campaign intelligence report.
 * Uses DS components: PageHeader, ReportTable, SectionDivider, AssetPreview, StatusBadge.
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
import type { CcrReportData, CampaignData, CreativeData } from '../lib/types';

interface Props {
  data: CcrReportData;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('_video.');
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

function campaignName(raw: string): string {
  return raw.replace(/\s+\d{7,}$/, '').trim() || raw;
}

export function CcrReport({ data }: Props) {
  const [narrativeHtml, setNarrativeHtml] = useState('');

  useEffect(() => {
    if (data.narrative) {
      renderMarkdown(data.narrative).then(setNarrativeHtml);
    }
  }, [data.narrative]);

  const allDomains = [data.brand, ...(data.competitors || [])];
  const totalImps = allDomains.reduce((s, d) => s + d.totalImpressions, 0) || 1;

  return (
    <div className="ccr-report">
      <PageHeader
        title={`Campaign Intelligence: ${data.brand.domain}`}
        subtitle={`${(data.competitors || []).length} competitors · 3-month rolling window · ${formatDate(data.generatedAt)}`}
        meta={<StatusBadge status="complete" label="Analysis Complete" />}
      />

      {/* ── Comparison Table ───────────────────────────────────────── */}
      <SectionDivider label="Campaign Comparison" />
      <ReportTable<CampaignData>
        columns={[
          { key: 'domain', header: 'Advertiser', render: r =>
            r.domain === data.brand.domain
              ? <><strong>{r.domain}</strong> <StatusBadge status="info" label="Brand" /></>
              : r.domain
          },
          { key: 'impressions', header: 'Imps', render: r => fmtNumber(r.totalImpressions), align: 'right' },
          { key: 'spend', header: 'Spend', render: r => `$${fmtMoney(r.totalSpend)}`, align: 'right' },
          { key: 'cpm', header: 'CPM', render: r => r.totalImpressions > 0 ? `$${((r.totalSpend / r.totalImpressions) * 1000).toFixed(2)}` : '—', align: 'right' },
          { key: 'sov', header: 'SOV', render: r => `${((r.totalImpressions / totalImps) * 100).toFixed(1)}%`, align: 'right' },
          { key: 'channels', header: 'Channels', render: r => (r.channels || []).map(c => c.name).join(', ') || '—' },
        ]}
        rows={allDomains}
        getKey={r => r.domain}
      />

      {/* ── Creatives by Campaign ─────────────────────────────────── */}
      {allDomains.some(d => (d.creatives || []).length > 0) && (
        <>
          <SectionDivider label="Ad Creatives" />
          {allDomains.map(comp => {
            const creatives = (comp.creatives || []).filter(c => c.url);
            if (creatives.length === 0) return null;

            const byCampaign = new Map<string, (CreativeData & { impressions?: number; spend?: number })[]>();
            for (const c of creatives) {
              const camp = campaignName((c as any).all_campaigns || (c as any).campaignName || 'Uncategorized');
              if (!byCampaign.has(camp)) byCampaign.set(camp, []);
              byCampaign.get(camp)!.push(c as any);
            }

            const domainLabel = comp.domain === data.brand.domain ? `${comp.domain} (Brand)` : comp.domain;

            return (
              <div key={comp.domain} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: 'var(--text)', margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>{domainLabel}</h4>
                {Array.from(byCampaign.entries()).map(([camp, campCreatives]) => (
                  <div key={camp} style={{ marginBottom: '1rem', paddingLeft: '0.5rem' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.375rem' }}>{camp}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {campCreatives.slice(0, 4).map(c => (
                        <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: 200 }}>
                          <AssetPreview
                            type={isVideoUrl(c.url) ? 'video' : 'image'}
                            url={c.url}
                          />
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                            {(c as any).impressions ? `${fmtNumber((c as any).impressions)} imps` : ''}
                            {(c as any).spend ? ` · $${fmtMoney((c as any).spend)}` : ''}
                            {c.firstSeen ? ` · ${c.firstSeen}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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
