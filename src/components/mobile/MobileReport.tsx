/**
 * Mobile report — 3 KPI tiles + campaign cards with creative carousel.
 * Progressive: shields show loading state per section, thin dividers between.
 */
import { KpiTile, StatusBadge, AssetPreview, SectionDivider, ReportBlock } from '@AiDigital-com/design-system'
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

function getTopCampaign(comp: CampaignData): { name: string; creatives: CreativeData[] } | null {
  const creatives = (comp.creatives || []).filter(c => c.url)
  if (creatives.length === 0) return null

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

  const summaries = data.summaries as Record<string, any> | undefined
  const verifiedDomains = data.verifiedDomains as string[] | undefined
  const brandDomain = data.brandDomain || brand?.domain || ''

  const brandSov = brand ? ((brand.totalImpressions / totalImps) * 100) : null
  const topComp = competitors.length > 0 ? competitors[0] : null
  const avgCpm = allDomains.length > 0
    ? allDomains.reduce((s, d) => s + (d.totalImpressions > 0 ? (d.totalSpend / d.totalImpressions * 1000) : 0), 0) / allDomains.length
    : null

  const hasCampaigns = !!brand
  const hasInsights = !!data.insights
  const hasVerified = !!(verifiedDomains && verifiedDomains.length > 0)

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
          description="1-month average"
        />
      </div>

      {/* ── Executive Summary ────────────────────────────────── */}
      <SectionDivider label="Executive Summary" />
      <ReportBlock
        status={hasInsights ? 'ready' : 'loading'}
        loadingLabel="Generating insights…"
      >
        <div className="ccr-m-summary">
          <p>{data.insights?.executiveSummary}</p>
        </div>
      </ReportBlock>

      {/* ── Top Campaigns ────────────────────────────────────── */}
      <SectionDivider label="Top Campaigns" />
      <ReportBlock
        status={hasCampaigns ? 'ready' : hasVerified ? 'loading' : 'loading'}
        loadingLabel={hasVerified ? 'Filtering campaigns…' : 'Discovering competitors…'}
      >
        {hasCampaigns ? (
          <div className="ccr-m-cards">
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
                  {top && (() => {
                    const lp = (data.landingPages || []).find((l: any) =>
                      l.domain === comp.domain && campaignName(l.campaignName) === top.name
                    )
                    return (
                      <>
                        <div className="ccr-m-card-campaign">{top.name}</div>
                        <div className="ccr-m-carousel">
                          {top.creatives.slice(0, 2).map(c => (
                            <div key={c.id} className="ccr-m-carousel-item">
                              <AssetPreview type={isVideoUrl(c.url) ? 'video' : 'image'} url={c.url} />
                            </div>
                          ))}
                          {lp?.screenshotUrl && (
                            <div className="ccr-m-carousel-item">
                              <AssetPreview type="image" url={lp.screenshotUrl} label={lp.title || 'Landing Page'} />
                            </div>
                          )}
                          {lp && !lp.screenshotUrl && lp.url && (
                            <div className="ccr-m-carousel-item">
                              <AssetPreview type="url" url={lp.url} label={lp.title || 'Landing Page'} />
                            </div>
                          )}
                        </div>
                      </>
                    )
                  })()}
                  {!top && (
                    <div className="ccr-m-card-campaign" style={{ opacity: 0.5 }}>No creative data</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : hasVerified ? (
          <div className="ccr-m-cards">
            {verifiedDomains!.slice(0, 5).map(d => (
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
        ) : null}
      </ReportBlock>
    </div>
  )
}
