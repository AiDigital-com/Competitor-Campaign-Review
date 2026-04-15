/**
 * CcrReport — competitor campaign intelligence report.
 * Grid layout: brands vertical → campaigns horizontal → creatives vertical → metrics bubbles.
 * DS components: PageHeader, ReportTable, SectionDivider, AssetPreview, StatusBadge.
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
import type { CcrReportData, CampaignData, CreativeData, ActionItem } from '../lib/types';

interface Props {
  data: CcrReportData;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('_video.');
}

function ActionColumn({ title, items }: { title: string; items: ActionItem[] }) {
  if (!items.length) return null;
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)',
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '0.5rem 0.75rem', fontWeight: 600, fontSize: '0.8rem',
        color: 'var(--text)', borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)',
      }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} style={{
          padding: '0.5rem 0.75rem',
          borderBottom: i < items.length - 1 ? '1px solid var(--border)' : undefined,
        }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.25rem' }}>
            {item.action}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {item.rationale}
          </div>
        </div>
      ))}
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

function campaignName(raw: string): string {
  return raw.replace(/\s+\d{7,}$/, '').trim() || raw;
}

/** Group creatives by campaign name. */
function groupByCampaign(creatives: CreativeData[]): Map<string, CreativeData[]> {
  const map = new Map<string, CreativeData[]>();
  for (const c of creatives) {
    const camp = campaignName(c.campaignName || (c as any).all_campaigns || 'Uncategorized');
    if (!map.has(camp)) map.set(camp, []);
    map.get(camp)!.push(c);
  }
  return map;
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

      {/* ── Creative Grid: brands vertical → campaigns horizontal ── */}
      {allDomains.some(d => (d.creatives || []).length > 0) && (
        <>
          <SectionDivider label="Ad Creatives by Campaign" />
          {allDomains.map(comp => {
            const creatives = (comp.creatives || []).filter(c => c.url);
            if (creatives.length === 0) return null;

            const campaigns = groupByCampaign(creatives);
            const isBrand = comp.domain === data.brand.domain;

            return (
              <div key={comp.domain} style={{ marginBottom: '1.5rem' }}>
                {/* Brand header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{comp.domain}</span>
                  {isBrand && <StatusBadge status="info" label="Brand" />}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {fmtNumber(comp.totalImpressions)} imps · ${fmtMoney(comp.totalSpend)} · {campaigns.size} campaign{campaigns.size !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Campaigns: horizontal scroll */}
                <div style={{
                  display: 'flex',
                  gap: '1rem',
                  overflowX: 'auto',
                  paddingBottom: '0.5rem',
                }}>
                  {Array.from(campaigns.entries()).map(([campName, campCreatives]) => {
                    const campImps = campCreatives.reduce((s, c) => s + (c.impressions || 0), 0);
                    const campSpend = campCreatives.reduce((s, c) => s + (c.spend || 0), 0);

                    return (
                      <div key={campName} style={{
                        minWidth: 220,
                        maxWidth: 260,
                        flexShrink: 0,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm, 8px)',
                        background: 'var(--surface)',
                        overflow: 'hidden',
                      }}>
                        {/* Campaign name */}
                        <div style={{
                          padding: '0.5rem 0.75rem',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'var(--text)',
                          borderBottom: '1px solid var(--border)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }} title={campName}>
                          {campName}
                        </div>

                        {/* Creatives: vertical stack */}
                        <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {campCreatives.slice(0, 3).map(c => (
                            <AssetPreview
                              key={c.id}
                              type={isVideoUrl(c.url) ? 'video' : 'image'}
                              url={c.url}
                            />
                          ))}
                        </div>

                        {/* Metrics bubbles */}
                        <div style={{
                          padding: '0.5rem 0.75rem',
                          borderTop: '1px solid var(--border)',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.375rem',
                        }}>
                          {campImps > 0 && (
                            <span style={{
                              fontSize: '0.65rem', padding: '0.125rem 0.5rem',
                              borderRadius: '999px', background: 'var(--surface2)',
                              color: 'var(--text-muted)', border: '1px solid var(--border)',
                            }}>{fmtNumber(campImps)} imps</span>
                          )}
                          {campSpend > 0 && (
                            <span style={{
                              fontSize: '0.65rem', padding: '0.125rem 0.5rem',
                              borderRadius: '999px', background: 'var(--surface2)',
                              color: 'var(--text-muted)', border: '1px solid var(--border)',
                            }}>${fmtMoney(campSpend)}</span>
                          )}
                          {campImps > 0 && campSpend > 0 && (
                            <span style={{
                              fontSize: '0.65rem', padding: '0.125rem 0.5rem',
                              borderRadius: '999px', background: 'var(--surface2)',
                              color: 'var(--text-muted)', border: '1px solid var(--border)',
                            }}>CPM ${((campSpend / campImps) * 1000).toFixed(2)}</span>
                          )}
                          {campCreatives[0]?.firstSeen && (
                            <span style={{
                              fontSize: '0.65rem', padding: '0.125rem 0.5rem',
                              borderRadius: '999px', background: 'var(--surface2)',
                              color: 'var(--text-muted)', border: '1px solid var(--border)',
                            }}>Since {campCreatives[0].firstSeen}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── Executive Summary ─────────────────────────────────────── */}
      {(data.insights?.executiveSummary || narrativeHtml) && (
        <>
          <SectionDivider label="Executive Summary" />
          <div className="aidl-report-viewer">
            <div className="aidl-report-content"
              dangerouslySetInnerHTML={{ __html: data.insights?.executiveSummary || narrativeHtml }}
            />
          </div>
        </>
      )}

      {/* ── Action Items (3 columns) ──────────────────────────────── */}
      {data.insights && (data.insights.creativeActions?.length || data.insights.spendingActions?.length || data.insights.channelActions?.length) && (
        <>
          <SectionDivider label="Recommended Actions" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <ActionColumn title="Creatives" items={data.insights.creativeActions || []} />
            <ActionColumn title="Spending" items={data.insights.spendingActions || []} />
            <ActionColumn title="Channels" items={data.insights.channelActions || []} />
          </div>
        </>
      )}

      {/* ── Fallback narrative (if no structured insights) ─────────── */}
      {!data.insights && narrativeHtml && (
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
