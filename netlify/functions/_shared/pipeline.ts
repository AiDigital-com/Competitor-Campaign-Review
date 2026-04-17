/**
 * Shared pipeline utilities for CCR N-Lambda architecture.
 *
 * Provides helpers for:
 * - Getting supabase client (service role)
 * - Incremental report_data updates (jsonb merge)
 * - Inserting next pipeline tasks
 * - Updating job_status progress
 * - Checking if sibling tasks are complete (for parallel phase)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAppUrl } from '@AiDigital-com/design-system/utils';

export const APP_NAME = 'competitor-campaign-review';
export const SESSION_TABLE = 'ccr_sessions';

export function getSupabase(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Merge partial data into ccr_sessions.report_data (jsonb).
 * Uses Supabase's jsonb concatenation via RPC or direct update.
 */
export async function mergeReportData(
  supabase: SupabaseClient,
  sessionId: string,
  partial: Record<string, any>,
): Promise<void> {
  // Read current, merge, write back (atomic enough for single-writer pipeline)
  const { data } = await supabase
    .from(SESSION_TABLE)
    .select('report_data')
    .eq('id', sessionId)
    .single();

  const current = (data?.report_data as Record<string, any>) || {};
  const merged = { ...current, ...partial };

  await supabase
    .from(SESSION_TABLE)
    .update({ report_data: merged, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
}

/**
 * Update job_status progress step.
 */
export async function setStep(
  supabase: SupabaseClient,
  jobId: string,
  step: string,
): Promise<void> {
  await supabase.from('job_status').update({
    meta: { current_step: step },
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
}

/**
 * Insert one or more pipeline tasks.
 */
export async function insertTasks(
  supabase: SupabaseClient,
  sessionId: string,
  tasks: { taskType: string; payload: Record<string, any> }[],
): Promise<void> {
  const rows = tasks.map(t => ({
    scan_id: sessionId,
    app: APP_NAME,
    task_type: t.taskType,
    status: 'pending',
    payload: t.payload,
    attempts: 0,
    max_attempts: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  await supabase.from('pipeline_tasks').insert(rows);

  // Kick task-worker with retries. From background functions, the network call
  // sometimes fails transiently — retry to make the handoff reliable.
  const siteUrl = getAppUrl(APP_NAME, { serverUrl: process.env.URL });
  const taskNames = rows.map(r => r.task_type).join(', ');

  const kickOnce = async (attempt: number): Promise<boolean> => {
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/task-worker`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
      });
      console.log(`[pipeline] Task-worker kick attempt ${attempt}: ${res.status} for ${taskNames}`);
      return res.ok || res.status === 202;
    } catch (err: any) {
      console.warn(`[pipeline] Task-worker kick attempt ${attempt} failed for ${taskNames}:`, err?.message || err);
      return false;
    }
  };

  // Try up to 3 times. First attempt immediate, then 1s delay, then 3s delay.
  const delays = [0, 1000, 3000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    if (await kickOnce(i + 1)) return;
  }
  console.error(`[pipeline] All task-worker kick attempts failed for ${taskNames} — relying on poller`);
}

/**
 * Check if all Phase 3 data sections are present in report_data.
 * Used by parallel Lambdas (3a/3b/3c) — the last one to write triggers Lambda 4.
 * Checks actual data presence rather than task status (which the task-worker
 * marks "complete" on 202 before the background function finishes).
 */
export async function isPhase3DataComplete(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(SESSION_TABLE)
    .select('report_data')
    .eq('id', sessionId)
    .single();

  const rd = (data?.report_data as Record<string, any>) || {};
  const hasCampaigns = !!rd.brand && Array.isArray(rd.competitors);
  const hasLandingPages = Array.isArray(rd.landingPages);
  const hasPublishers = !!rd.publishersByDomain;

  return hasCampaigns && hasLandingPages && hasPublishers;
}

/**
 * Mark pipeline as complete — update job_status + session status.
 */
export async function markComplete(
  supabase: SupabaseClient,
  sessionId: string,
  jobId: string,
): Promise<void> {
  // Read final report_data for the job_status report field
  const { data } = await supabase
    .from(SESSION_TABLE)
    .select('report_data')
    .eq('id', sessionId)
    .single();

  const reportData = data?.report_data || {};

  await supabase.from('job_status').update({
    status: 'complete',
    report: JSON.stringify(reportData),
    meta: { current_step: 'Complete' },
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);

  await supabase.from(SESSION_TABLE).update({
    status: 'complete',
    updated_at: new Date().toISOString(),
  }).eq('id', sessionId);
}

/**
 * Mark pipeline as errored.
 */
export async function markError(
  supabase: SupabaseClient,
  sessionId: string,
  jobId: string,
  error: Error | string,
): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  await supabase.from('job_status').update({
    status: 'error',
    error: `${msg}\n---STACK---\n${stack ?? 'no stack'}`,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);

  await supabase.from(SESSION_TABLE).update({
    status: 'error',
    updated_at: new Date().toISOString(),
  }).eq('id', sessionId);
}
