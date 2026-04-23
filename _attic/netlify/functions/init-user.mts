import type { Context } from '@netlify/functions';
import { requireAuth } from './_shared/auth.ts';
import { supabase } from './_shared/supabase.ts';

export default async (req: Request, _context: Context) => {
  try {
    const { userId, email } = await requireAuth(req);

    // AppShell v7+ uses Supabase RPC for init-user.
    // This function is kept as a fallback / migration path.
    // The RPC `init_user` handles upsert into app_users with:
    //   - user_id (Clerk ID)
    //   - user_email
    //   - status: 'trial' (default)
    //   - session_count: 0

    const { data, error } = await (supabase as any).rpc('init_user', {
      p_user_id: userId,
      p_user_email: email ?? '',
    });

    if (error) {
      console.warn('[init-user] RPC error, falling back:', error.message);
      return Response.json({ status: 'active', session_count: 0 });
    }

    return Response.json(data ?? { status: 'active', session_count: 0 });
  } catch (err) {
    // Non-fatal — return a safe default so the app loads
    return Response.json({ status: 'active', session_count: 0 }, { status: 200 });
  }
};
