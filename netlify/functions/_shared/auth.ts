import { verifyToken, createClerkClient } from '@clerk/backend';
import { createClient } from '@supabase/supabase-js';
import { getUserStatus } from './supabase.js';
import { log } from './logger.js';

// TODO: Change to your app's identifier
const EMBED_APP_NAME = 'competitor-campaign-review';

/** Authenticate via Clerk JWT, embed token, or API key.
 *  Embed: X-Embed-Token header → validate_embed_token RPC → userId = "embed:{org_id}"
 *  API key: X-API-Key header with "aidl_" prefix → userId = "api:{key_prefix}"
 *  Clerk: Authorization header → standard JWT verification
 *  Returns { userId, email, isEmbed } or throws on failure. */
export async function requireAuthOrEmbed(req: Request): Promise<{ userId: string; email: string | null; isEmbed?: boolean }> {
  // Check embed token
  const embedToken = req.headers.get('X-Embed-Token');
  if (embedToken) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase not configured');
    const sb = createClient(url, key);
    const { data } = await sb.rpc('validate_embed_token', {
      p_token: embedToken,
      p_app: EMBED_APP_NAME,
      p_origin: req.headers.get('Origin') || null,
    });
    if (!data?.valid) throw new Error('Invalid embed token');
    return { userId: `embed:${data.org_id || 'anonymous'}`, email: null, isEmbed: true };
  }

  // Check mobile anonymous access
  const mobileSource = req.headers.get('X-Mobile-Source');
  if (mobileSource === 'ccr-mobile') {
    return { userId: 'mobile:anonymous', email: null };
  }

  // Check API key (for API and internal dispatch calls)
  // Access control is skipped for api: users — they are pre-authorized via key validation
  const apiKey = req.headers.get('X-API-Key');
  if (apiKey?.startsWith('aidl_')) {
    return { userId: `api:${apiKey.substring(5, 13)}`, email: null };
  }

  return requireAuth(req);
}

/** Extract and verify the Clerk session token from the Authorization header.
 *  Returns { userId, email } or throws on failure. */
export async function requireAuth(req: Request): Promise<{ userId: string; email: string | null }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not configured');

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) {
    log.warn('auth.failure', { function_name: 'auth', message: 'Unauthorized', meta: { endpoint: req.url } });
    throw new Error('Unauthorized');
  }

  // verifyToken is a standalone function in @clerk/backend Core 3
  const payload = await verifyToken(token, { secretKey });
  const userId = payload.sub;

  // Fetch primary email via the client
  let email: string | null = null;
  try {
    const clerk = createClerkClient({ secretKey });
    const user = await clerk.users.getUser(userId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    email = primary?.emailAddress ?? null;
  } catch {
    // non-fatal — email used only for grouping
  }

  return { userId, email };
}

/** Checks if user is admin (by DB status or ADMIN_EMAILS env var). */
export async function isAdminUser(userId: string): Promise<boolean> {
  const row = await getUserStatus(userId);
  if (row?.status === 'admin') return true;
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const userEmail = row?.user_email?.toLowerCase();
  return userEmail ? adminEmails.includes(userEmail) : false;
}
