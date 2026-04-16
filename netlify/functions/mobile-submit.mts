/**
 * Mobile submit — anonymous dispatch with campaign gating.
 * If campaignSlug provided, atomically claims a use before dispatching.
 */
import { createClient } from '@supabase/supabase-js';
import { createDispatchHandler } from '@AiDigital-com/design-system/server';

const dispatchHandler = createDispatchHandler({
  app: 'competitor-campaign-review',
  sessionTable: 'ccr_sessions',
  skipAuth: true,
  anonymousUserId: 'mobile:anonymous',
});

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export default async function handler(req: Request): Promise<Response> {
  let campaignSlug: string | null = null;
  try {
    const body = await req.clone().json();
    campaignSlug = body?.campaignSlug ?? null;
  } catch {}

  if (campaignSlug) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('claim_campaign_use', { p_slug: campaignSlug });

    if (error) {
      console.error('[mobile-submit] claim_campaign_use error:', error);
      return Response.json({ error: 'Campaign check failed' }, { status: 500 });
    }

    if (!data?.ok) {
      const reason = data?.reason ?? 'limit_reached';
      const endedMessage = data?.ended_message ?? null;
      return Response.json({ error: reason, ended_message: endedMessage }, { status: 429 });
    }
  }

  return dispatchHandler(req);
}
