/**
 * CCR scheduled task-poller — B1 safety net.
 * Runs every minute, drains up to 5 pending tasks per invocation.
 * taskFunctionMap mirrors task-worker.mts exactly.
 */
import type { Config } from '@netlify/functions';
import { createTaskPoller } from '@AiDigital-com/design-system/server';

export default createTaskPoller({
  app: 'competitor-campaign-review',
  taskFunctionMap: {
    run_audit: 'ccr-discover',
    ccr_verify: 'ccr-verify',
    ccr_campaign_detail: 'ccr-campaign-detail',
    ccr_firecrawl: 'ccr-firecrawl',
    ccr_publishers: 'ccr-publishers',
    ccr_synthesize: 'ccr-synthesize',
  },
  maxPerInvocation: 5,
});

export const config: Config = {
  schedule: '* * * * *',
};
