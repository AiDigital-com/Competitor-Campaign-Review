import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://njwzbptrhgznozpndcxf.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(supabaseUrl, supabaseKey);
}

/** Lazy-init Supabase client (Proxy pattern — safe for cold starts). */
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    return (getSupabase() as any)[prop];
  },
});

// ── User Management ──────────────────────────────────────────────────────────

export async function getUserStatus(userId: string) {
  const sb = getSupabase();
  const { data } = await sb.from('app_users').select('*').eq('user_id', userId).maybeSingle();
  return data ?? null;
}

export async function incrementUserSessionCount(userId: string) {
  const sb = getSupabase();
  const { data: row } = await sb
    .from('app_users')
    .select('session_count, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (!row) return;

  const newCount = (row.session_count ?? 0) + 1;
  let newStatus = row.status;
  if (row.status === 'trial' && newCount >= 10) {
    newStatus = 'pending';
  }

  await sb
    .from('app_users')
    .update({ session_count: newCount, status: newStatus, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

// ── Session Management ───────────────────────────────────────────────────────
// TODO: Add your app-specific table queries here.
// Follow the same pattern as getUserStatus above.
// Example:
//
// export async function createSession(params: { id: string; userId: string; ... }) {
//   const sb = getSupabase();
//   await sb.from('sessions').upsert({ ... }, { onConflict: 'id' });
// }
//
// export async function getSessionById(id: string) {
//   const sb = getSupabase();
//   const { data } = await sb.from('sessions').select('*').eq('id', id).maybeSingle();
//   return data ?? null;
// }

// ── Job Status ───────────────────────────────────────────────────────────────

export async function writeJobStatus(jobId: string, payload: Record<string, unknown>) {
  const sb = getSupabase();
  await sb.from('job_status').upsert(
    {
      id: jobId,
      app: 'competitor-campaign-review',  // TODO: Change to your app name
      ...payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}

export async function readJobStatus(jobId: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('job_status')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  return data ?? null;
}
