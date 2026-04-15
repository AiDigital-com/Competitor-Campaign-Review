/**
 * Mobile submit — anonymous dispatch handler for /m route.
 * No Clerk auth required. Uses DS createDispatchHandler with skipAuth.
 */
import { createDispatchHandler } from '@AiDigital-com/design-system/server';

export default createDispatchHandler({
  app: 'competitor-campaign-review',
  sessionTable: 'ccr_sessions',
  skipAuth: true,
  anonymousUserId: 'mobile:anonymous',
});
