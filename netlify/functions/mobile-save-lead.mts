/**
 * POST /.netlify/functions/mobile-save-lead
 * Save lead from CCR mobile intake. Mirrors the AIO endpoint shape so the
 * normalized landing-page form (email → org → brand) can ship symmetrically
 * across both products. Writes to the shared campaign_leads table with
 * app='ccr'.
 *
 * Called twice per session:
 *   1. At intake — creates the lead with email + org + brand_name
 *   2. Post-pipeline (when user taps "Get Full Report") — same row is
 *      upserted with the resolved share_url so /m can redirect to /r/<token>
 *
 * Body: { sessionId, email, orgName, brandName, brandDomain?, campaignSlug? }
 * Returns: { saved: true, shareUrl }
 */
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const supabase = getSupabase();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, email, orgName, brandName, brandDomain, campaignSlug } = body as {
    sessionId: string;
    email?: string;
    orgName: string;
    brandName: string;
    brandDomain?: string;
    campaignSlug?: string;
  };

  if (!sessionId || !orgName || !brandName) {
    return Response.json({ error: 'sessionId, orgName, brandName required' }, { status: 400 });
  }

  // Resolve campaign_id from slug (if provided)
  let campaignId: string | null = null;
  if (campaignSlug) {
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id')
      .eq('slug', campaignSlug)
      .maybeSingle();
    campaignId = campaign?.id ?? null;
  }

  // Pull share_token from ccr_sessions. The pipeline sets it during synthesis;
  // retry up to 5x (2s apart) if the user taps "Get Full Report" before the
  // pipeline has written the token. Cold-start (intake call) usually misses —
  // that's fine, we generate a placeholder.
  let shareToken: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: sessionData } = await supabase
      .from('ccr_sessions')
      .select('share_token')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionData?.share_token) {
      shareToken = sessionData.share_token;
      break;
    }
    if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
  }

  // If pipeline hasn't set it yet, generate one and stamp it on the row so
  // the eventual share-link visit resolves to the same token.
  if (!shareToken) {
    shareToken = crypto.randomUUID();
    await supabase
      .from('ccr_sessions')
      .update({ share_token: shareToken, is_public: true })
      .eq('id', sessionId);
    console.log(`[ccr mobile-save-lead] Generated share_token for session ${sessionId}`);
  }

  const shareUrl = `https://competitorcampaign.apps.aidigitallabs.com/r/${shareToken}`;

  // Upsert by session_id — if the intake call already created the row, the
  // post-pipeline call just refreshes share_url (and the rest of the columns
  // stay put). Email may be null only if a caller intentionally skipped it.
  const { data: existing } = await supabase
    .from('campaign_leads')
    .select('id')
    .eq('session_id', sessionId)
    .eq('app', 'ccr')
    .maybeSingle();

  if (existing) {
    const update: Record<string, unknown> = { share_url: shareUrl };
    if (email) update.email = email;
    if (brandDomain) update.brand_domain = brandDomain;
    await supabase
      .from('campaign_leads')
      .update(update)
      .eq('id', existing.id);
    console.log(`[ccr mobile-save-lead] Lead updated for session ${sessionId} (${email ?? '(no email)'})`);
    return Response.json({ saved: true, shareUrl }, { status: 200 });
  }

  const { error } = await supabase.from('campaign_leads').insert({
    campaign_id: campaignId,
    app: 'ccr',
    session_id: sessionId,
    email: email ?? null,
    org_name: orgName,
    brand_name: brandName,
    brand_domain: brandDomain ?? null,
    share_url: shareUrl,
  });

  if (error) {
    console.error('[ccr mobile-save-lead] DB error:', error);
    return Response.json({ error: 'Failed to save' }, { status: 500 });
  }

  console.log(`[ccr mobile-save-lead] Lead saved: ${email ?? '(no email)'} (${orgName}) → session ${sessionId}${campaignId ? ` campaign ${campaignSlug}` : ''}`);

  return Response.json({ saved: true, shareUrl }, { status: 200 });
};
