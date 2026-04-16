/**
 * Mobile Orchestrator — resolves brand input → domain, always dispatches.
 * No confirmation, no chat. Single LLM call → tool call → done.
 * Anonymous access via X-Mobile-Source header.
 */
import { createLLMProvider, type ToolDefinition, type ToolCall } from '@AiDigital-com/design-system/server';
import { createClient } from '@supabase/supabase-js';

const APP_NAME = 'competitor-campaign-review';

const DISPATCH_TOOL: ToolDefinition = {
  name: 'dispatch_task',
  description: 'Dispatch competitor analysis for the resolved brand domain.',
  parameters: {
    type: 'object',
    properties: {
      brand_domain: {
        type: 'string',
        description: 'The resolved brand domain (e.g. "coca-cola.com").',
      },
    },
    required: ['brand_domain'],
  },
};

const SYSTEM_PROMPT = `You resolve brand input into a domain and IMMEDIATELY call dispatch_task. No exceptions.

Rules:
- URL input: extract root domain (e.g. "https://www.nike.com/us/shoes" → "nike.com"). Call dispatch_task.
- Brand name: resolve to most likely official domain (e.g. "coca cola" → "coca-cola.com", "pepsi" → "pepsi.com"). Call dispatch_task.
- Ambiguous input: make your best guess. ALWAYS call dispatch_task on the first attempt. Never ask for clarification.
- You MUST call dispatch_task exactly once. No text response needed.`;

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Anonymous mobile auth
  const mobileSource = req.headers.get('X-Mobile-Source');
  if (mobileSource !== 'ccr-mobile') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  const { userInput } = await req.json();
  if (!userInput) {
    return Response.json({ error: 'Missing userInput' }, { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

  try {
    let resolvedDomain: string | null = null;

    await llm.streamChat({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userInput }],
      tools: [DISPATCH_TOOL],
      callbacks: {
        onText: () => {},
        onToolCalls: (calls: ToolCall[]) => {
          for (const call of calls) {
            if (call.name === 'dispatch_task' && call.args?.brand_domain) {
              resolvedDomain = call.args.brand_domain;
            }
          }
        },
      },
      app: `${APP_NAME}:mobile-orchestrator`,
      userId: 'mobile:anonymous',
    });

    if (!resolvedDomain) {
      return Response.json({ error: 'Could not resolve brand domain' }, { status: 422 });
    }

    return Response.json({ brand_domain: resolvedDomain });
  } catch (err) {
    console.error('[mobile-orchestrator] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
};
