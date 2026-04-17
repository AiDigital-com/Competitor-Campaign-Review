/**
 * CCR API Result — fetch completed report via X-API-Key auth.
 * Returns structured report_data (visual) + synthesized markdown summary.
 */
import { createClient } from '@supabase/supabase-js';
import { validateApiKey, logApiRequest, apiKeyErrorResponse } from '@AiDigital-com/design-system/server';
import { APP_NAME } from './_shared/pipeline.js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function fmtNum(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Build a markdown report from structured report_data for LLM consumption. */
function buildMarkdownReport(rd: Record<string, any>): string {
  const brand = rd.brand;
  const competitors = (rd.competitors || []) as any[];
  const insights = rd.insights;
  const generatedAt = rd.generatedAt ? new Date(rd.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  const lines: string[] = [];
  lines.push(`# Competitor Campaign Review: ${brand?.domain || 'Unknown'}`);
  lines.push(`_1-month rolling window · ${generatedAt}_`);
  lines.push('');

  if (insights?.executiveSummary) {
    lines.push('## Executive Summary');
    lines.push(insights.executiveSummary);
    lines.push('');
  }

  lines.push('## Campaign Comparison');
  lines.push('');
  lines.push('| Advertiser | Parent | Product Line | Impressions | Spend | CPM | SOV |');
  lines.push('|---|---|---|---|---|---|---|');
  const allDomains = brand ? [brand, ...competitors] : competitors;
  const totalImps = allDomains.reduce((s: number, d: any) => s + (d.totalImpressions || 0), 0) || 1;
  for (const d of allDomains) {
    const cpm = d.totalImpressions > 0 ? ((d.totalSpend / d.totalImpressions) * 1000).toFixed(2) : '—';
    const sov = ((d.totalImpressions / totalImps) * 100).toFixed(1);
    lines.push(`| ${d.domain}${d === brand ? ' (brand)' : ''} | ${d.parentCompany || '—'} | ${d.productLine || '—'} | ${fmtNum(d.totalImpressions)} | $${fmtNum(d.totalSpend)} | $${cpm} | ${sov}% |`);
  }
  lines.push('');

  if (insights?.creativeActions?.length) {
    lines.push('## Creative Recommendations');
    for (const a of insights.creativeActions) lines.push(`- **${a.action}** — ${a.rationale}`);
    lines.push('');
  }
  if (insights?.spendingActions?.length) {
    lines.push('## Spending Recommendations');
    for (const a of insights.spendingActions) lines.push(`- **${a.action}** — ${a.rationale}`);
    lines.push('');
  }
  if (insights?.channelActions?.length) {
    lines.push('## Channel Recommendations');
    for (const a of insights.channelActions) lines.push(`- **${a.action}** — ${a.rationale}`);
    lines.push('');
  }

  return lines.join('\n');
}

export default async (req: Request) => {
  const start = Date.now();

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const supabase = getSupabase();
  const auth = await validateApiKey(req, APP_NAME, supabase as any);
  if (!auth.valid) return apiKeyErrorResponse(auth);

  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  const format = url.searchParams.get('format') || 'both';

  if (!jobId) {
    return Response.json({ error: 'job_id is required' }, { status: 400 });
  }

  const { data: job } = await supabase
    .from('job_status')
    .select('id, status, error, meta')
    .eq('id', jobId)
    .eq('app', APP_NAME)
    .maybeSingle();

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status !== 'complete') {
    return Response.json(
      { job_id: jobId, status: job.status, error: job.error },
      { status: 202 }
    );
  }

  const sessionId = (job.meta as any)?.session_id || jobId;
  const { data: session } = await supabase
    .from('ccr_sessions')
    .select('id, brand_name, intake_summary, report_data, share_token, updated_at')
    .eq('id', sessionId)
    .maybeSingle();

  const reportData = (session?.report_data as Record<string, any>) || {};
  const markdown = format === 'visual' ? '' : buildMarkdownReport(reportData);
  const visual = format === 'markdown' ? null : reportData;

  const reportUrl = session?.share_token
    ? `https://competitorcampaign.apps.aidigitallabs.com/r/${session.share_token}`
    : null;

  await logApiRequest(supabase as any, {
    keyId: auth.keyId!,
    app: APP_NAME,
    endpoint: 'result',
    statusCode: 200,
    durationMs: Date.now() - start,
  });

  return Response.json({
    job_id: jobId,
    session_id: sessionId,
    status: 'complete',
    intake_summary: session?.intake_summary,
    has_visual_report: !!visual && Object.keys(visual).length > 0,
    markdown_report: markdown,
    visual_report: visual,
    report_url: reportUrl,
    completed_at: session?.updated_at,
  });
};
