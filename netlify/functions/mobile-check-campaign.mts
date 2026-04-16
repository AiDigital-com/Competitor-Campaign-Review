/**
 * Mobile campaign check — validates campaign slug from ?c= param.
 * Returns campaign status (active, uses remaining, etc.)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('c');

  if (!slug) {
    return Response.json({ ok: true, campaign: null });
  }

  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, slug, app, max_uses, uses_count, active, starts_at, ends_at, ended_message')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) {
    return Response.json({ ok: false, reason: 'campaign_not_found' });
  }

  const now = new Date();
  if (!data.active) {
    return Response.json({ ok: false, reason: 'campaign_inactive', ended_message: data.ended_message });
  }
  if (data.ends_at && new Date(data.ends_at) < now) {
    return Response.json({ ok: false, reason: 'campaign_ended', ended_message: data.ended_message });
  }
  if (data.starts_at && new Date(data.starts_at) > now) {
    return Response.json({ ok: false, reason: 'not_started', ended_message: data.ended_message });
  }
  if (data.max_uses != null && data.uses_count >= data.max_uses) {
    return Response.json({ ok: false, reason: 'limit_reached', ended_message: data.ended_message });
  }

  return Response.json({
    ok: true,
    campaign: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      uses_remaining: data.max_uses != null ? data.max_uses - data.uses_count : null,
    },
  });
}
