import type { Context } from '@netlify/functions';
import { requireAuth, isAdminUser } from './_shared/auth.ts';
import { supabase } from './_shared/supabase.ts';

export default async (req: Request, _context: Context) => {
  try {
    const { userId } = await requireAuth(req);

    // Verify admin access
    const admin = await isAdminUser(userId);
    if (!admin) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);

    // TODO: Implement admin queries
    // The AdminPanel component from the design system calls these patterns:
    // GET ?domain=...       -> return { users: [...] }
    // GET ?userId=...       -> return { sessions: [...] }
    // GET ?action=set_user_status&userId=...&status=... -> update user status
    // GET ?action=set_org_status&domain=...&status=...  -> update org status
    // GET (no params)       -> return { accounts: [...] }

    return Response.json({ accounts: [] });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
