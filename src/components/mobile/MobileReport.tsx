/**
 * Mobile report — 3 KPI tiles + campaign cards with creative carousel.
 * Progressive: tiles fill in after verify, cards after campaign-detail.
 */
import { KpiTile, StatusBadge, AssetPreview } from '@AiDigital-com/design-system'
import type { CampaignData, CreativeData } from '../../lib/types'

interface Props {
  data: Record<string, any>
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toFixed(0)
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('_video.')
}

function campaignName(raw: string): string {
  return raw.replace(/\s+\d{7,}$/, '').trim() || raw
}

/** Get top campaign by impressions for a domain */
function getTopCampaign(comp: CampaignData): { name: string; creatives: CreativeData[] } | null {
  const creatives = (comp.creatives || []).filter(c => c.url)
  if (creatives.length === 0) return null

  // Group by campaign name, find the one with most total impressions
  const groups = new Map<string, CreativeData[]>()
  for (const c of creatives) {
    const camp = campaignName(c.campaignName || 'Uncategorized')
    if (!groups.has(camp)) groups.set(camp, [])
    groups.get(camp)!.push(c)
  }

  let topName = ''
  let topImps = -1
  for (const [name, items] of groups) {
    const total = items.reduce((s, c) => s + (c.impressions || 0), 0)
    if (total > topImps) { topImps = total; topName = name }
  }

  return topName ? { name: topName, creatives: groups.get(topName)! } : null
}

export function MobileReport({ data }: Props) {
  const brand = data.brand as CampaignData | undefined
  const competitors = (data.competitors || []) as CampaignData[]
  const allDomains = brand ? [brand, ...competitors] : []
  const totalImps = allDomains.reduce((s, d) => s + d.totalImpressions, 0) || 1

  // Preliminary data from verify phase (before campaign-detail completes)
  const summaries = data.summaries as Record<string, any> | undefined
  const verifiedDomains = data.verifiedDomains as string[] | undefined
  const brandDomain = data.brandDomain || brand?.domain || ''

  // KPI values
  const brandSov = brand ? ((brand.totalImpressions / totalImps) * 100) : null
  const topComp = competitors.length > 0 ? competitors[0] : null
  const avgCpm = allDomains.length > 0
    ? allDomains.reduce((s, d) => s + (d.totalImpressions > 0 ? (d.totalSpend / d.totalImpressions * 1000) : 0), 0) / allDomains.length
    : null

  // Use summary data for preliminary KPIs before campaign-detail finishes
  const hasCampaigns = !!brand
  let prelimSov: number | null = null
  let prelimCompCount: number | null = null
  if (!hasCampaigns && summaries && brandDomain && summaries[brandDomain]) {
    const allSummaryImps = Object.values(summaries).reduce((s: number, d: any) => s + (d.totalImpressions || 0), 0) || 1
    prelimSov = ((summaries[brandDomain].totalImpressions || 0) / allSummaryImps) * 100
    prelimCompCount = verifiedDomains?.length || null
  }

  return (
    <div className="ccr-m-report">
      {/* ── KPI Tiles ────────────────────────────────────────── */}
      <div className="ccr-m-kpi">
        <KpiTile
          label="Brand SOV"
          value={brandSov !== null ? `${brandSov.toFixed(1)}%` : prelimSov !== null ? `~${prelimSov.toFixed(0)}%` : '—'}
          description={brandDomain || 'Analyzing…'}
        />
        <KpiTile
          label="Top Competitor"
          value={topComp ? topComp.domain.replace('.com', '') : prelimCompCount !== null ? `${prelimCompCount}` : '—'}
          description={topComp ? `$${fmtMoney(topComp.totalSpend)}` : prelimCompCount !== null ? 'competitors found' : 'Discovering…'}
        />
        <KpiTile
          label="Avg CPM"
          value={avgCpm !== null ? `$${avgCpm.toFixed(2)}` : '—'}
          description="3-month average"
        />
      </div>

      {/* ── Exec Summary (if available) ──────────────────────── */}
      {data.insights?.executiveSummary && (
        <div className="ccr-m-summary">
          <div className="ccr-m-section-label">Executive Summary</div>
          <p>{data.insights.executiveSummary}</p>
        </div>
      )}

      {/* ── Campaign Cards ───────────────────────────────────── */}
      {hasCampaigns && (
        <div className="ccr-m-cards">
          <div className="ccr-m-section-label">Top Campaigns</div>
          {allDomains.map(comp => {
            const top = getTopCampaign(comp)
            const isBrand = comp.domain === brand?.domain
            const cpm = comp.totalImpressions > 0 ? (comp.totalSpend / comp.totalImpressions * 1000) : 0

            return (
              <div key={comp.domain} className="ccr-m-card">
                <div className="ccr-m-card-header">
                  <span className="ccr-m-card-domain">{comp.domain}</span>
                  {isBrand && <StatusBadge status="info" label="Brand" />}
                </div>
                <div className="ccr-m-card-metrics">
                  <span>{fmtNumber(comp.totalImpressions)} imps</span>
                  <span>${fmtMoney(comp.totalSpend)}</span>
                  <span>${cpm.toFixed(2)} CPM</span>
                </div>
                {top && (
                  <>
                    <div className="ccr-m-card-campaign">{top.name}</div>
                    <div className="ccr-m-carousel">
                      {top.creatives.slice(0, 6).map(c => (
                        <div key={c.id} className="ccr-m-carousel-item">
                          <AssetPreview type={isVideoUrl(c.url) ? 'video' : 'image'} url={c.url} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {!top && (
                  <div className="ccr-m-card-campaign" style={{ opacity: 0.5 }}>No creative data</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Preliminary: show domain list while campaigns load ── */}
      {!hasCampaigns && verifiedDomains && verifiedDomains.length > 0 && (
        <div className="ccr-m-cards">
          <div className="ccr-m-section-label">Verified Competitors</div>
          {verifiedDomains.slice(0, 5).map(d => (
            <div key={d} className="ccr-m-card">
              <div className="ccr-m-card-header">
                <span className="ccr-m-card-domain">{d}</span>
              </div>
              {summaries?.[d] && (
                <div className="ccr-m-card-metrics">
                  <span>{fmtNumber(summaries[d].totalImpressions || 0)} imps</span>
                  <span>${fmtMoney(summaries[d].totalSpend || 0)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
