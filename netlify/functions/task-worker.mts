/**
 * CCR task worker — uses shared DS handler.
 * Routes pipeline_tasks to the correct background function.
 */
import { createTaskWorker } from '@AiDigital-com/design-system/server';

export default createTaskWorker({
  app: 'competitor-campaign-review',
  taskFunctionMap: {
    ccr_discover: 'ccr-discover',
    ccr_verify: 'ccr-verify',
    ccr_campaign_detail: 'ccr-campaign-detail',
    ccr_firecrawl: 'ccr-firecrawl',
    ccr_publishers: 'ccr-publishers',
    ccr_synthesize: 'ccr-synthesize',
  },
});
