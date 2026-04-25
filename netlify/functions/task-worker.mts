/**
 * CCR task worker — uses shared DS handler.
 * Routes pipeline_tasks to the correct background function.
 */
import { createTaskWorker } from '@AiDigital-com/design-system/server';

export default createTaskWorker({
  app: 'competitor-campaign-review',
  taskFunctionMap: {
    run_audit: 'ccr-discover-background',
    ccr_verify: 'ccr-verify-background',
    ccr_campaign_detail: 'ccr-campaign-detail-background',
    ccr_firecrawl: 'ccr-firecrawl-background',
    ccr_publishers: 'ccr-publishers-background',
    ccr_synthesize: 'ccr-synthesize-background',
  },
});
