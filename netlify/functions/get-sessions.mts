import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@AiDigital-com/design-system/server';

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const { userId } = await requireAuth(req);
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await supabase
    .from('app_sessions')
    .select('id, brand_name, status, created_at')
    .eq('user_id', userId)
    .or('deleted_by_user.is.null,deleted_by_user.eq.false')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ sessions: data });
};
