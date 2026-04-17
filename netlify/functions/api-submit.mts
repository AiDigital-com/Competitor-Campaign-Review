/**
 * CCR API Submit — called by Concierge (and other API consumers) to dispatch
 * a competitor campaign review via X-API-Key auth.
 */
import { createClient } from '@supabase/supabase-js';
import { validateApiKey, logApiRequest, apiKeyErrorResponse } from '@AiDigital-com/design-system/server';
import { APP_NAME } from './_shared/pipeline.js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export default async (req: Request) => {
  const start = Date.now();

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const supabase = getSupabase();
  const auth = await validateApiKey(req, APP_NAME, supabase as any);
  if (!auth.valid) return apiKeyErrorResponse(auth);

  const body = await req.json().catch(() => ({}));
  const brandDomainRaw: string | undefined = body.brand_domain;
  const dispatchedByUser: string | undefined = body._dispatched_by_user;
  const dispatchedByEmail: string | undefined = body._dispatched_by_email;

  if (!brandDomainRaw) {
    return Response.json({ error: 'brand_domain is required' }, { status: 400 });
  }

  const brandDomain = brandDomainRaw.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  const sessionId = crypto.randomUUID();
  const userId = dispatchedByUser || `api:${auth.keyId}`;

  await supabase.from('ccr_sessions').upsert({
    id: sessionId,
    user_id: userId,
    brand_name: brandDomain,
    intake_summary: { brand_domain: brandDomain, source: 'api' },
    status: 'pending',
    deleted_by_user: false,
  }, { onConflict: 'id' });

  await supabase.from('job_status').upsert({
    id: sessionId,
    app: APP_NAME,
    status: 'pending',
    meta: {
      session_id: sessionId,
      source: 'api',
      key_id: auth.keyId,
      dispatched_by_user: dispatchedByUser,
      dispatched_by_email: dispatchedByEmail,
    },
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  await supabase.from('pipeline_tasks').insert({
    scan_id: sessionId,
    app: APP_NAME,
    task_type: 'run_audit',
    status: 'pending',
    payload: {
      jobId: sessionId,
      intakeSummary: { brand_domain: brandDomain, source: 'api', brand_name: brandDomain },
      userId,
    },
    attempts: 0,
    max_attempts: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const baseUrl = process.env.URL || 'https://competitorcampaign.apps.aidigitallabs.com';
  fetch(`${baseUrl}/.netlify/functions/task-worker`, { method: 'POST' }).catch(() => {});

  await logApiRequest(supabase as any, {
    keyId: auth.keyId!,
    app: APP_NAME,
    endpoint: 'submit',
    statusCode: 202,
    durationMs: Date.now() - start,
  });

  return Response.json({ job_id: sessionId, session_id: sessionId, status: 'pending' }, { status: 202 });
};
