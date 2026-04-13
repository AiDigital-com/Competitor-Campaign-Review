/**
 * Orchestrator — SSE streaming chat agent.
 *
 * Uses the DS LLM wrapper (createLLMProvider) for provider-agnostic AI calls.
 * NEVER use @google/genai directly — always go through the DS wrapper.
 *
 * Pattern: stream text deltas + tool calls via SSE. Frontend uses parseSSEStream().
 */
import { createLLMProvider, type ToolDefinition, type ToolCall, type ChatMessage } from '@AiDigital-com/design-system/server';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { log } from './_shared/logger.js';
import { createClient } from '@supabase/supabase-js';

// TODO: Change to your app name
const APP_NAME = 'competitor-campaign-review';

// TODO: Define your dispatch tool
const DISPATCH_TOOL: ToolDefinition = {
  name: 'dispatch_task',
  description: 'Dispatch the main task once all intake information has been collected.',
  parameters: {
    type: 'object',
    properties: {
      // TODO: Add your intake fields
      summary: { type: 'string', description: 'Summary of the task' },
    },
    required: ['summary'],
  },
};

// TODO: Write your system prompt (or import from a separate file)
const SYSTEM_PROMPT = `You are the intake coordinator for [Your App]. Gather the required information, then call dispatch_task.`;

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let authEmail: string | null = null;
  let authUserId: string | null = null;
  try {
    const auth = await requireAuthOrEmbed(req);
    authEmail = auth.email;
    authUserId = auth.userId;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { messages = [], userId } = body;
  const uid = userId || authUserId;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

  const chatMessages: ChatMessage[] = messages.map((m: { role: string; content: string }) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const keepAliveInterval = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15_000);

      log.info('orchestrator.start', {
        function_name: 'orchestrator',
        user_id: uid,
        user_email: authEmail,
        ai_provider: llm.provider,
        ai_model: llm.model,
        meta: { messageCount: messages?.length },
      });
      const startTime = Date.now();

      try {
        const result = await llm.streamChat({
          system: SYSTEM_PROMPT,
          messages: chatMessages,
          tools: [DISPATCH_TOOL],
          callbacks: {
            onText: (text) => emit({ type: 'text_delta', text }),
            onToolCalls: (calls: ToolCall[]) => {
              for (const call of calls) {
                if (call.name === 'dispatch_task') {
                  // TODO: Change event type to match your app (e.g. 'audit_dispatch', 'review_dispatch')
                  emit({ type: 'task_dispatch', intakeSummary: call.args });
                }
              }
            },
          },
          app: `${APP_NAME}:orchestrator`,
          userId: uid,
        });

        log.info('orchestrator.complete', {
          function_name: 'orchestrator',
          user_id: uid,
          user_email: authEmail,
          duration_ms: Date.now() - startTime,
          ai_provider: llm.provider,
          ai_model: llm.model,
          ai_input_tokens: result.usage.inputTokens,
          ai_output_tokens: result.usage.outputTokens,
          ai_total_tokens: result.usage.totalTokens,
          ai_thinking_tokens: result.usage.thinkingTokens,
        });
        emit({ type: 'done' });
      } catch (err) {
        console.error('Orchestrator error:', err);
        log.error('orchestrator.error', {
          function_name: 'orchestrator',
          user_id: uid,
          user_email: authEmail,
          error: err,
          error_category: 'ai_api',
          duration_ms: Date.now() - startTime,
        });
        emit({ type: 'error', message: String(err) });
      } finally {
        clearInterval(keepAliveInterval);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
