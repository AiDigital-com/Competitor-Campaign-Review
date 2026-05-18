import { createLogger } from '@AiDigital-com/design-system-sdk/server';
import { supabase } from './supabase.js';

// TODO: Change 'competitor-campaign-review' to your app's tool ID
export const log = createLogger(supabase as any, 'competitor-campaign-review');
