/**
 * CCR API Status — poll job progress via X-API-Key auth.
 * Uses DS handleApiStatus for standardized response shape.
 */
import { createClient } from '@supabase/supabase-js';
import { handleApiStatus } from '@AiDigital-com/design-system/server';
import { APP_NAME } from './_shared/pipeline.js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export default async (req: Request) => {
  return handleApiStatus(req, APP_NAME, getSupabase() as any);
};
