import { checkAccess, recordUsage, getUserOrgId } from '@AiDigital-com/design-system/access';
import { supabase } from './supabase.js';

export async function enforceAccess(userId: string, app: string) {
  return await checkAccess(supabase as any, userId, app);
}

export async function trackUsage(userId: string, app: string) {
  const orgId = await getUserOrgId(supabase as any, userId);
  await recordUsage(supabase as any, userId, orgId, app);
}
