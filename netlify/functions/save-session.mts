/**
 * Session merge endpoint — atomic read-merge-write.
 * Uses DS mergeSession utility with service role (survives JWT expiry).
 *
 * Required by useSessionPersistence. Every chat app needs this endpoint.
 */
import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { mergeSession } from '@AiDigital-com/design-system/server';

// TODO: Change to your session table name
const SESSION_TABLE = 'ccr_sessions';

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, patch, mergeConfig } = await req.json();
  if (!sessionId) {
    return Response.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let result = await mergeSession(supabase, {
    table: SESSION_TABLE,
    sessionId,
    patch,
    mergeConfig: mergeConfig || { objectFields: ['intake_summary'] },
  });

  // If session doesn't exist yet (race with createSession), create it
  if (!result.ok && (result.error?.includes('not found') || result.error?.includes('Cannot coerce') || result.error?.includes('0 rows'))) {
    const { error: insertError } = await supabase
      .from(SESSION_TABLE)
      .insert({ id: sessionId, ...patch })
      .select('id')
      .single();
    if (insertError) {
      result = await mergeSession(supabase, {
        table: SESSION_TABLE,
        sessionId,
        patch,
        mergeConfig: mergeConfig || { objectFields: ['intake_summary'] },
      });
    } else {
      result = { ok: true };
    }
  }

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json(result);
};
