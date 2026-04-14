/**
 * Orchestrator — SSE streaming intake agent for Competitor Campaign Review.
 *
 * Two input modes:
 * 1. URL/domain typed in chat → extracts domain → dispatches immediately.
 * 2. Image upload → analyzes image with generateContent → confirms domain → dispatches.
 *
 * All LLM calls go through createLLMProvider (DS wrapper). Never use @google/genai directly.
 */
import { createLLMProvider, type ToolDefinition, type ToolCall, type ChatMessage } from '@AiDigital-com/design-system/server';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { log } from './_shared/logger.js';
import { createClient } from '@supabase/supabase-js';

const APP_NAME = 'competitor-campaign-review';

const DISPATCH_TOOL: ToolDefinition = {
  name: 'dispatch_task',
  description: 'Dispatch competitor analysis once the brand domain is confirmed.',
  parameters: {
    type: 'object',
    properties: {
      brand_domain: {
        type: 'string',
        description: 'The target brand domain to analyze (e.g. "nike.com").',
      },
      source: {
        type: 'string',
        enum: ['url', 'image'],
        description: 'How the domain was provided — "url" if typed, "image" if from uploaded creative.',
      },
    },
    required: ['brand_domain', 'source'],
  },
};

const BASE_SYSTEM_PROMPT = `You are the intake coordinator for the Competitor Campaign Review tool.
Your goal: identify the target brand domain and call dispatch_task.

Two input modes:
1. URL/domain typed by user: Extract the domain (e.g. "nike.com" from "https://www.nike.com/us/t/air-max"). Call dispatch_task immediately — no confirmation needed.
2. Image upload: The system will provide image analysis results. Confirm the brand with the user, suggest the domain, and dispatch once confirmed (a simple "yes" or "looks good" is sufficient).

Keep responses brief — 1-2 sentences. Do not explain what you're doing.`;

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
  const { messages = [], userId, imageBase64, imageMimeType } = body;
  const uid = userId || authUserId;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const llmFast = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

  // ── Image pre-analysis ──────────────────────────────────────────────────────
  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (imageBase64 && imageMimeType) {
    try {
      const llmAnalysis = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });
      // Strip data URL prefix if present
      const rawBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');

      const analysis = await llmAnalysis.generateContent({
        prompt: 'Analyze this advertisement or brand image. Return JSON only, no markdown: {"brandName": "...", "suggestedDomain": "...", "category": "..."}',
        userParts: [{ inlineData: { data: rawBase64, mimeType: imageMimeType } }],
        app: `${APP_NAME}:image-analysis`,
        userId: uid,
        jsonMode: true,
      });

      let parsed: { brandName?: string; suggestedDomain?: string; category?: string } = {};
      try {
        parsed = JSON.parse(analysis.text);
      } catch {
        const match = analysis.text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }

      if (parsed.brandName && parsed.suggestedDomain) {
        systemPrompt += `\n\nImage analysis: The uploaded creative is from brand "${parsed.brandName}" (${parsed.category || 'unknown category'}). Suggested domain: "${parsed.suggestedDomain}". Your first response must confirm this with the user: "This looks like a campaign from [brand]. Should I use [domain] for the competitor analysis?" Then wait for confirmation before dispatching.`;
      }
    } catch (err) {
      console.warn('Image analysis failed, falling back to text intake:', err);
      systemPrompt += `\n\nThe user uploaded a campaign image. Ask them: "I've received your image. What brand or website domain should I analyze for competitor intelligence?"`;
    }
  }

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
        ai_provider: llmFast.provider,
        ai_model: llmFast.model,
        meta: { messageCount: messages?.length, hasImage: !!imageBase64 },
      });
      const startTime = Date.now();

      try {
        const result = await llmFast.streamChat({
          system: systemPrompt,
          messages: chatMessages,
          tools: [DISPATCH_TOOL],
          callbacks: {
            onText: (text) => emit({ type: 'text_delta', text }),
            onToolCalls: (calls: ToolCall[]) => {
              for (const call of calls) {
                if (call.name === 'dispatch_task') {
                  emit({ type: 'competitor_dispatch', intakeSummary: call.args });
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
          ai_provider: llmFast.provider,
          ai_model: llmFast.model,
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
