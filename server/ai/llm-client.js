import { getToolDefinitions } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { buildSystemPrompt } from './system-prompt.js';
import { isRefusalResponse, createAutonomousJailbreakMutation } from './heretic-engine.js';
import { addMessage, getMessages, searchMemories, saveToolResult } from '../memory/store.js';
import config from '../config.js';
import OpenAI from 'openai';
import { setTimeout as delay } from 'node:timers/promises';

let openaiClient = null;
const providerSlots = new WeakMap();
const INVALID_TOOL_NAME = '__invalid_tool_call__';
export const EMPTY_FINAL_RESPONSE = '[PHANTOM] No usable final answer was returned. No further action was taken.';

async function paceProvider(client, api, signal) {
  if (!(api.baseUrl || '').includes('nvidia') && !(api.apiKey || '').startsWith('nvapi-')) return;
  const now = Date.now();
  const slot = Math.max(now, providerSlots.get(client) || 0);
  providerSlots.set(client, slot + 1500);
  if (slot > now) await delay(slot - now, undefined, { signal });
}
export function parseToolArguments(rawArguments) {
  if (rawArguments === undefined || rawArguments === null || (typeof rawArguments === 'string' && !rawArguments.trim())) {
    return { ok: false, code: 'invalid_tool_arguments', error: 'Tool arguments were empty.', args: {} };
  }

  if (typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    return { ok: true, args: rawArguments };
  }

  if (typeof rawArguments !== 'string') {
    return { ok: false, code: 'invalid_tool_arguments', error: 'Tool arguments must be a JSON object.', args: {} };
  }

  try {
    const parsed = JSON.parse(rawArguments);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 'invalid_tool_arguments', error: 'Tool arguments must be a JSON object.', args: {} };
    }
    return { ok: true, args: parsed };
  } catch {
    return { ok: false, code: 'invalid_tool_arguments', error: 'Tool arguments were not valid JSON.', args: {} };
  }
}

function normalizeToolCall(rawToolCall, index, iteration = 0, usedIds = new Set()) {
  const source = rawToolCall && typeof rawToolCall === 'object' ? rawToolCall : {};
  const functionPart = source.function && typeof source.function === 'object' ? source.function : {};
  let id = typeof source.id === 'string' && source.id.trim()
    ? source.id.trim()
    : `tool-call-${iteration + 1}-${index + 1}`;
  while (usedIds.has(id)) id = `${id}-${index + 1}`;
  usedIds.add(id);

  const name = typeof functionPart.name === 'string' && functionPart.name.trim()
    ? functionPart.name.trim()
    : INVALID_TOOL_NAME;
  const parsedArguments = parseToolArguments(functionPart.arguments);
  const assistantArguments = parsedArguments.ok
    ? JSON.stringify(parsedArguments.args)
    : JSON.stringify({ _invalid_tool_call: true, error: parsedArguments.error });

  return {
    id,
    name,
    args: parsedArguments.args,
    argumentError: parsedArguments.ok ? null : parsedArguments,
    valid: name !== INVALID_TOOL_NAME && parsedArguments.ok,
    assistantCall: {
      id,
      type: 'function',
      function: { name, arguments: assistantArguments },
    },
  };
}

function normalizeToolCalls(toolCalls, iteration = 0) {
  if (!Array.isArray(toolCalls)) return [];
  const usedIds = new Set();
  return toolCalls
    .filter(call => call !== undefined)
    .map((call, index) => normalizeToolCall(call, index, iteration, usedIds));
}

function sanitizeToolCalls(toolCalls) {
  return normalizeToolCalls(toolCalls).map(call => call.assistantCall);
}

function appendToolCallDelta(toolCalls, rawDelta) {
  const delta = rawDelta && typeof rawDelta === 'object' ? rawDelta : {};
  const functionPart = delta.function && typeof delta.function === 'object' ? delta.function : {};
  let index = Number.isInteger(delta.index) && delta.index >= 0 ? delta.index : -1;

  if (index < 0 && delta.id) {
    index = toolCalls.findIndex(call => call?.id === delta.id);
  }
  if (index < 0 && toolCalls.length > 0 && !delta.id && functionPart.name === undefined && functionPart.arguments !== undefined) {
    index = toolCalls.length - 1;
  }
  if (index < 0) index = toolCalls.length;

  if (!toolCalls[index]) {
    toolCalls[index] = {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
  }

  const call = toolCalls[index];
  if (delta.id !== undefined && delta.id !== null) call.id = String(delta.id);
  if (functionPart.name !== undefined && functionPart.name !== null) call.function.name += String(functionPart.name);
  if (functionPart.arguments !== undefined && functionPart.arguments !== null) {
    const fragment = typeof functionPart.arguments === 'string'
      ? functionPart.arguments
      : JSON.stringify(functionPart.arguments);
    call.function.arguments += fragment || '';
  }
}

function serializeToolValue(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toolFailurePayload(toolName, code, message) {
  return JSON.stringify({
    ok: false,
    tool: toolName,
    error: { code, message: String(message || 'Tool execution failed') },
  });
}

function detectToolFailure(result) {
  if (result && typeof result === 'object' && (result.ok === false || result.success === false)) return 'tool_returned_failure';
  const text = serializeToolValue(result).trim();
  if (!text) return 'empty_tool_result';
  if (/^(?:Error\b|Unknown tool\b|Install not started\b|Request error\b|Scrape error\b|Delegation (?:not started|error)\b|\[SUDO_REQUIRED\]|.*\[(?:TIMEOUT|EXIT CODE)\])/i.test(text)) {
    return 'tool_returned_failure';
  }
  return null;
}

function emitEmptyFinalResponse(conversationId, onChunk, finishReason) {
  const response = finishReason === 'tool_calls'
    ? `${EMPTY_FINAL_RESPONSE} The model did not provide a usable tool call either.`
    : EMPTY_FINAL_RESPONSE;
  if (typeof onChunk === 'function') onChunk(response);
  addMessage(conversationId, { role: 'assistant', content: response });
  return response;
}

function notifyToolCallback(callback, payload, label) {
  if (typeof callback !== 'function') return;
  try {
    callback(payload);
  } catch (error) {
    console.warn(`[LLMClient] ${label} callback failed:`, error?.message || error);
  }
}

/**
 * Adapt messages specifically for sensitive backends like NVIDIA NIM / Nemotron / vLLM.
 * Many non-OpenAI endpoints fail with 500 when:
 * 1. An assistant message with tool_calls has content: null (must be empty string "" or omitted)
 * 2. Tool response messages have missing or invalid fields
 * 3. Empty messages are passed
 */
export function formatMessagesForModel(rawMessages, isNvidia = false) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.map(msg => {
    if (!msg || typeof msg !== 'object') return { role: 'user', content: '' };
    const cleaned = { role: msg.role };

    if (msg.role === 'assistant') {
      // NVIDIA NIM / Nemotron crashes with 500 when content is null
      cleaned.content = typeof msg.content === 'string' ? msg.content : (isNvidia ? '' : (msg.content ?? ''));
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        cleaned.tool_calls = msg.tool_calls.map(tc => ({
          id: String(tc.id || 'call_0'),
          type: 'function',
          function: {
            name: String(tc.function?.name || ''),
            arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
          },
        }));
      }
    } else if (msg.role === 'tool') {
      cleaned.content = typeof msg.content === 'string' ? msg.content : serializeToolValue(msg.content);
      if (msg.tool_call_id) cleaned.tool_call_id = String(msg.tool_call_id);
      if (msg.name) cleaned.name = String(msg.name);
    } else {
      cleaned.content = typeof msg.content === 'string' ? msg.content : (msg.content !== undefined && msg.content !== null ? String(msg.content) : '');
    }

    return cleaned;
  });
}


function isTransientProviderError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(error?.status))
    || /econnreset|econnrefused|etimedout|socket hang up|fetch failed|network error|connection reset|temporarily unavailable/.test(message);
}

function getClient() {
  const apiKey = config.api.apiKey || 'sk-placeholder';
  const baseURL = config.api.baseUrl || 'https://api.openai.com/v1';

  if (!openaiClient || openaiClient.baseURL !== baseURL || openaiClient.apiKey !== apiKey) {
    openaiClient = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 0, // The bounded, abortable retry loop below owns retries.
      defaultHeaders: {
        'HTTP-Referer': 'https://phantom.ai',
        'X-Title': 'PHANTOM Security Center',
      }
    });
  }
  return openaiClient;
}

export function resetClient() {
  openaiClient = null;
}

export { getClient };

/**
 * Process a user message: send to LLM with tools, handle tool calls recursively, stream responses.
 * Now supports:
 *  - Bounded tool iterations with terminal partial-result synthesis
 *  - AbortSignal for stopping mid-operation
 *  - Thinking/reasoning token detection
 *  - Live tool output streaming via onToolProgress
 */
export async function processMessage(conversationId, userMessage, sessionContext, onChunk, onToolCall, onToolResult, onError, onThinking, abortSignal, onToolProgress, agentRole = 'default', executionContext = null) {
  // Snapshot this turn's provider settings; another tab saving Settings must not
  // change the model/temperature halfway through a tool loop.
  const api = { ...config.api };
  const client = getClient();
  const toolExecutionContext = executionContext || {
    rootConversationId: conversationId,
    delegationDepth: 0,
  };
  // Get conversation history
  const history = getMessages(conversationId, 40);

  // Build messages array
  let messages = [
    { role: 'system', content: await buildSystemPrompt(sessionContext, agentRole) },
  ];

  // Determine which model to use based on agent role
  let targetModel = api.model;
  if (config.agents?.enabled) {
    if (agentRole === 'planner') targetModel = config.agents.plannerModel;
    if (agentRole === 'executor') targetModel = config.agents.executorModel;
  }

  // Add memory context
  try {
    // Shared memories are explicit opt-in, not implicit cross-chat context.
    const relevantMemories = sessionContext?.includeSharedMemory === true ? searchMemories(userMessage) : [];
    if (relevantMemories.length > 0) {
      const memoryContext = relevantMemories.map(m => `[${m.category}] ${m.key}: ${m.value}`).join('\n');
      messages.push({
        role: 'system',
        content: `## RELEVANT MEMORIES\n${memoryContext}`,
      });
    }
  } catch (err) {
    console.warn(`[LLMClient] Failed to retrieve memory context:`, err.message);
  }

  // Limit history to last 40 messages to keep context window lean
  const recentHistory = history.slice(-40);

  // Clean up truncated history: ensure we don't start with orphan tool responses
  // and ensure all assistant tool_calls have matching tool responses
  while (recentHistory.length > 0 && (recentHistory[0].role === 'tool' || recentHistory[0].tool_call_id)) {
    recentHistory.shift();
  }

  for (let i = 0; i < recentHistory.length; i++) {
    const msg = recentHistory[i];
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const expectedToolCalls = msg.tool_calls;
      const actualToolResponses = [];
      let j = i + 1;
      while (j < recentHistory.length && (recentHistory[j].role === 'tool' || recentHistory[j].tool_call_id)) {
        actualToolResponses.push(recentHistory[j]);
        j++;
      }

      const hasAllResponses = expectedToolCalls.every(tc => actualToolResponses.some(tr => tr.tool_call_id === tc.id)) &&
                              actualToolResponses.length === expectedToolCalls.length;

      if (!hasAllResponses) {
        delete msg.tool_calls;
        if (!msg.content) {
            msg.content = "[Tool calls omitted due to context window truncation]";
        }
        // Remove any orphaned responses for these tool calls
        recentHistory.splice(i + 1, actualToolResponses.length);
      }
    }
  }

  for (const msg of recentHistory) {
    const m = { role: msg.role, content: msg.content };
    if (msg.tool_calls) m.tool_calls = sanitizeToolCalls(msg.tool_calls);
    if (msg.tool_call_id) {
      m.tool_call_id = msg.tool_call_id;
      m.role = 'tool';
    }
    if (msg.name) m.name = msg.name;
    messages.push(m);
  }

  // Add the new user message
  messages.push({ role: 'user', content: userMessage });
  addMessage(conversationId, { role: 'user', content: userMessage });

  // Pre-fetch tool definitions once (don't re-fetch every loop iteration)
  const tools = getToolDefinitions();

  const maxToolIterations = Math.max(1, config.limits?.maxToolIterations || 12);
  let toolIterations = 0;
  let transientRetries = 0;
  const maxTransientRetries = 2;
  let jailbreakAttempts = 0;
  const maxJailbreakAttempts = 4;
  while (toolIterations < maxToolIterations) {
    // Check if aborted
    if (abortSignal?.aborted) {
      const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
      onChunk(abortMsg);
      addMessage(conversationId, { role: 'assistant', content: abortMsg });
      return abortMsg;
    }

    try {
      let response;
      let retries = 0;
      const isNvidia = (api.baseUrl || '').includes('nvidia') || (api.apiKey || '').startsWith('nvapi-');
      const maxRetries = isNvidia ? 6 : 4;

      while (retries < maxRetries) {
        try {
          await paceProvider(client, api, abortSignal);
          abortSignal?.throwIfAborted();

          // If planner, strictly forbid raw tool access (tools undefined)
          // The planner delegates to orchestrator/executors.
          const effectiveTools = (agentRole === 'planner') ? undefined : (tools.length > 0 ? tools : undefined);
          const effectiveToolChoice = (agentRole === 'planner') ? undefined : (tools.length > 0 ? 'auto' : undefined);

          // Sanitize and adapt messages for strict models/endpoints (e.g., NVIDIA NIM, Nemotron)
          const sanitizedMessages = formatMessagesForModel(messages, isNvidia);

          response = await client.chat.completions.create({
            model: targetModel,
            messages: sanitizedMessages,
            tools: effectiveTools,
            tool_choice: effectiveToolChoice,
            temperature: api.temperature,
            max_tokens: api.maxTokens,
            stream: true,
          }, {
            signal: abortSignal,
            timeout: Math.max(1000, Number(config.limits?.llmRequestTimeoutMs) || 120000),
          });
          break; // Success, exit retry loop
        } catch (apiError) {
          const message = String(apiError.message || '');
          if (apiError.status === 429 || message.includes('429') || message.includes('ResourceExhausted')) {
            retries++;
            if (retries >= maxRetries) throw apiError;
            const retryDelay = isNvidia ? Math.max(2000, retries * 2000) : Math.pow(2, retries) * 1000;
            console.log(`[PHANTOM] Rate limit hit (429). Retrying in ${retryDelay / 1000}s...`);
            await delay(retryDelay, undefined, { signal: abortSignal });
            if (abortSignal?.aborted) throw new Error('Operation stopped by user.');
            continue;
          }
          throw apiError;
        }
      }

      let fullContent = '';
      let streamFlushed = !api.bypassCensorship;
      let streamBuffer = '';

      let toolCalls = [];
      let isInThinkBlock = false;
      let finishReason = null;

      for await (const chunk of response) {
        // Check abort between chunks
        if (abortSignal?.aborted) {
          const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
          onChunk(abortMsg);
          addMessage(conversationId, { role: 'assistant', content: abortMsg });
          return abortMsg;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Handle reasoning/thinking tokens (DeepSeek, Claude, etc.)
        // Some models send reasoning in a separate field
        if (delta.reasoning_content || delta.reasoning) {
          const thinkText = delta.reasoning_content || delta.reasoning;

          if (typeof onThinking === 'function') onThinking(thinkText);
          continue;
        }

        // Handle text content — detect <think> blocks inline
        if (typeof delta.content === 'string' && delta.content) {
          let text = delta.content;

          while (text.length > 0) {
            if (!isInThinkBlock) {
              const startIdx = text.indexOf('<think>');
              if (startIdx !== -1) {
                // Text before <think> is content
                if (startIdx > 0) {
                  const contentText = text.substring(0, startIdx);
                  fullContent += contentText;
                  if (streamFlushed) {
                    if (typeof onChunk === 'function') onChunk(contentText);
                  } else {
                    streamBuffer += contentText;
                    if (streamBuffer.length >= 120) {
                      if (!isRefusalResponse(streamBuffer)) {
                        if (typeof onChunk === 'function') onChunk(streamBuffer);
                        streamFlushed = true;
                        streamBuffer = '';
                      }
                    }
                  }
                }
                isInThinkBlock = true;
                text = text.substring(startIdx + '<think>'.length);
              } else {
                fullContent += text;
                if (streamFlushed) {
                  if (typeof onChunk === 'function') onChunk(text);
                } else {
                  streamBuffer += text;
                  if (streamBuffer.length >= 120) {
                    if (!isRefusalResponse(streamBuffer)) {
                      if (typeof onChunk === 'function') onChunk(streamBuffer);
                      streamFlushed = true;
                      streamBuffer = '';
                    }
                  }
                }
                text = '';
              }
            } else {
              const endIdx = text.indexOf('</think>');
              if (endIdx !== -1) {
                // Text before </think> is thinking
                if (endIdx > 0) {
                  const thinkText = text.substring(0, endIdx);
                  if (typeof onThinking === 'function') onThinking(thinkText);
                }
                isInThinkBlock = false;
                text = text.substring(endIdx + '</think>'.length);
              } else {
                if (typeof onThinking === 'function') onThinking(text);
                text = '';
              }
            }
          }
        }

        // Handle tool calls
        if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
          const toolDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [delta.tool_calls];
          for (const tc of toolDeltas) appendToolCallDelta(toolCalls, tc);
        }

        // Check for finish
        const chunkFinishReason = chunk.choices?.[0]?.finish_reason;
        if (chunkFinishReason) {
          finishReason = chunkFinishReason;
          if (chunkFinishReason === 'stop' || chunkFinishReason === 'tool_calls') break;
        }
      }

      // If we have tool calls, execute them
      const collectedToolCalls = toolCalls.filter(Boolean);
      if (collectedToolCalls.length > 0) {
        toolIterations += 1;
        const normalizedToolCalls = normalizeToolCalls(collectedToolCalls, toolIterations);
        // Save assistant message with tool calls
        const assistantMsg = {
          role: 'assistant',
          content: fullContent || '',
          tool_calls: normalizedToolCalls.map(call => call.assistantCall),
        };
        addMessage(conversationId, assistantMsg);
        messages.push(assistantMsg);

        // Execute each tool call
        for (const toolCall of normalizedToolCalls) {
          // Check abort before each tool execution
          if (abortSignal?.aborted) {
            const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
            onChunk(abortMsg);
            addMessage(conversationId, { role: 'assistant', content: abortMsg });
            return abortMsg;
          }

          const args = toolCall.args;
          notifyToolCallback(onToolCall, { id: toolCall.id, name: toolCall.name, args }, 'tool-call');

          const startTime = Date.now();
          let resultForModel;
          let failureCode = null;
          if (!toolCall.valid) {
            failureCode = toolCall.name === INVALID_TOOL_NAME
              ? 'invalid_tool_call'
              : (toolCall.argumentError?.code || 'invalid_tool_call');
            resultForModel = toolFailurePayload(
              toolCall.name,
              failureCode,
              toolCall.argumentError?.error || 'The tool call did not contain a valid function name and JSON object of arguments.',
            );
          } else {
            try {
              // Pass onToolProgress for live output streaming
              const rawResult = await executeTool(toolCall.name, args, (progressText) => {
                notifyToolCallback(onToolProgress, { id: toolCall.id, name: toolCall.name, text: progressText }, 'tool-progress');
              }, toolExecutionContext);
              failureCode = detectToolFailure(rawResult);
              resultForModel = failureCode
                ? toolFailurePayload(toolCall.name, failureCode, serializeToolValue(rawResult))
                : serializeToolValue(rawResult);
            } catch (error) {
              failureCode = 'tool_exception';
              resultForModel = toolFailurePayload(toolCall.name, failureCode, error?.message || error);
            }
          }
          const duration = Date.now() - startTime;

          // Truncate very long results
          const maxResultLen = 50000;
          let truncatedResult = resultForModel;
          if (truncatedResult.length > maxResultLen) {
            truncatedResult = truncatedResult.substring(0, maxResultLen) + `\n\n... [truncated, ${truncatedResult.length - maxResultLen} chars omitted]`;
          }

          notifyToolCallback(onToolResult, {
            id: toolCall.id,
            name: toolCall.name,
            result: truncatedResult,
            status: failureCode ? 'error' : 'success',
          }, 'tool-result');

          // Save tool result
          try {
            saveToolResult(conversationId, toolCall.name, args, truncatedResult, failureCode ? 'error' : 'success', duration);
          } catch (err) {
            console.error('[Tools] Failed to save tool result to memory:', err.message);
          }

          // Add tool result to messages
          const toolMsg = { role: 'tool', content: truncatedResult, tool_call_id: toolCall.id, name: toolCall.name };
          addMessage(conversationId, toolMsg);
          messages.push(toolMsg);
        }

        // Continue the loop — let the LLM process tool results
        continue;
      }

      // Heretic Engine: Intercept refusal and apply autonomous jailbreak mutation if bypassCensorship is enabled
      if (api.bypassCensorship && isRefusalResponse(fullContent) && jailbreakAttempts < maxJailbreakAttempts) {
        jailbreakAttempts++;
        console.log(`[Heretic Engine] Autonomous refusal vector intercepted (${fullContent.slice(0, 60)}...). Mutating representation (attempt ${jailbreakAttempts}/${maxJailbreakAttempts})...`);
        messages = createAutonomousJailbreakMutation(messages, userMessage, jailbreakAttempts);
        continue;
      }

      // Flush any remaining buffered stream tokens
      if (!streamFlushed && streamBuffer) {
        if (typeof onChunk === 'function') onChunk(streamBuffer);
        streamFlushed = true;
        streamBuffer = '';
      }

      // A provider can end a stream with no text and no usable tool call. Do not
      // return an empty assistant message: make the safe state explicit.
      if (fullContent.trim()) {
        addMessage(conversationId, { role: 'assistant', content: fullContent });
        return fullContent;
      }
      return emitEmptyFinalResponse(conversationId, onChunk, finishReason);

    } catch (error) {
      // If aborted, don't show as error
      if (abortSignal?.aborted) {
        const abortMsg = '[PHANTOM] ⏹ Operation stopped by user.';
        if (typeof onChunk === 'function') onChunk(abortMsg);
        addMessage(conversationId, { role: 'assistant', content: abortMsg });
        return abortMsg;
      }
      if (isTransientProviderError(error) && transientRetries < maxTransientRetries) {
        transientRetries += 1;
        const retryDelay = Math.min(5000, 1000 * (2 ** (transientRetries - 1)));
        try {
          await delay(retryDelay, undefined, { signal: abortSignal });
          continue;
        } catch {
          // Fall through to the user-facing error if the operation was stopped.
        }
      }

      // If one or more tools were already executed, the model might fail with 500
      // when multi-turn tool calling is requested. Gracefully recover by synthesizing
      // the final response with the tool outputs without throwing an error!
      if (toolIterations > 0) {
        console.warn(`[LLMClient] Provider threw error after tool execution (${error.message}). Synthesizing final answer without tools...`);
        try {
          return await produceToolLimitSummary({
            conversationId,
            messages,
            maxToolIterations,
            client,
            api,
            targetModel,
            abortSignal,
            onChunk,
            onThinking,
            customNotice: '', // No scary error notice, just give the final answer
          });
        } catch (synthesisError) {
          console.warn(`[LLMClient] Fallback synthesis also failed:`, synthesisError.message);
        }
      }

      const errMsg = `⚠️ LLM Error: ${error.message}`;
      if (typeof onError === 'function') onError(errMsg);
      if (typeof onChunk === 'function') {
        onChunk(`\n\n⚠️ **LLM Connection Error**: ${error.message}\n\nPlease check your API key, model selection (\`${targetModel}\`), or Base URL in **Manage (⚙️ Settings)**.`);
      }
      addMessage(conversationId, { role: 'assistant', content: errMsg });
      return errMsg;
    }
  }

  return await produceToolLimitSummary({
    conversationId,
    messages,
    maxToolIterations,
    client,
    api,
    targetModel,
    abortSignal,
    onChunk,
    onThinking,
  });
}

/**
 * Turn a bounded tool loop into a useful assistant answer. The synthesis pass
 * deliberately receives no tools, so a model cannot immediately consume the
 * budget again while trying to explain the partial work.
 */
export async function produceToolLimitSummary({
  conversationId,
  messages,
  maxToolIterations,
  client = getClient(),
  api = { ...config.api },
  targetModel = api.model,
  abortSignal,
  onChunk,
  onThinking,
  customNotice = null,
}) {
  const notice = customNotice !== null ? customNotice : `[PHANTOM] Tool-call budget reached after ${maxToolIterations} tool rounds.`;
  const summaryInstruction = {
    role: 'user',
    content: 'Review the tool results from the conversation above and provide a complete final answer and commentary for the user. Do not call any tools. Summarize findings, actions taken, and next recommendations clearly.',
  };

  if (notice && typeof onChunk === 'function') onChunk(`${notice}\n\n`);

  if (abortSignal?.aborted) {
    const stopped = `${notice ? `${notice}\n\n` : ''}The operation was stopped before the final response could be summarized.`;
    if (typeof onChunk === 'function') onChunk(stopped.slice(notice ? notice.length + 2 : 0));
    addMessage(conversationId, { role: 'assistant', content: stopped });
    return stopped;
  }

  try {
    await paceProvider(client, api, abortSignal);
    const isNvidia = (api.baseUrl || '').includes('nvidia') || (api.apiKey || '').startsWith('nvapi-');
    const sanitizedMessages = formatMessagesForModel([...messages, summaryInstruction], isNvidia);

    const response = await client.chat.completions.create({
      model: targetModel,
      messages: sanitizedMessages,
      // No tools/tool_choice here is intentional: this is a terminal summary.
      temperature: api.temperature,
      max_tokens: api.maxTokens,
      stream: true,
    }, {
      signal: abortSignal,
      timeout: Math.max(1000, Number(config.limits?.llmRequestTimeoutMs) || 120000),
    });

    let summary = '';
    for await (const chunk of response) {
      if (abortSignal?.aborted) break;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning_content || delta.reasoning) {
        if (typeof onThinking === 'function') onThinking(delta.reasoning_content || delta.reasoning);
        continue;
      }
      if (delta.content) {
        summary += delta.content;
        if (typeof onChunk === 'function') onChunk(delta.content);
      }
    }

    let finalContent;
    if (summary.trim()) {
      finalContent = `${notice}\n\n${summary.trim()}`;
    } else {
      const partial = buildPartialProgressSummary(messages);
      if (typeof onChunk === 'function') onChunk(partial);
      finalContent = `${notice}\n\n${partial}`;
    }
    addMessage(conversationId, { role: 'assistant', content: finalContent });
    return finalContent;
  } catch (error) {
    const fallback = `${notice}\n\n${buildPartialProgressSummary(messages)}\n\nFinal synthesis was unavailable: ${error.message}`;
    if (typeof onChunk === 'function') onChunk(fallback.slice(notice.length + 2));
    addMessage(conversationId, { role: 'assistant', content: fallback });
    return fallback;
  }
}

function buildPartialProgressSummary(messages) {
  const assistantProgress = messages
    .filter(message => message.role === 'assistant' && typeof message.content === 'string' && message.content.trim())
    .slice(-2)
    .map(message => message.content.replace(/\s+/g, ' ').trim().slice(0, 600));
  const toolResults = messages
    .filter(message => message.role === 'tool' && typeof message.content === 'string')
    .slice(-3)
    .map(message => {
      const compact = message.content.replace(/\s+/g, ' ').trim();
      return `- ${message.name || 'tool'}: ${compact.slice(0, 600)}${compact.length > 600 ? '…' : ''}`;
    });

  if (assistantProgress.length === 0 && toolResults.length === 0) {
    return 'Partial progress is available in the conversation above, but no tool result was produced.';
  }
  const sections = [];
  if (assistantProgress.length > 0) sections.push(`Assistant progress:\n${assistantProgress.map(item => `- ${item}`).join('\n')}`);
  if (toolResults.length > 0) sections.push(`Tool results:\n${toolResults.join('\n')}`);
  return `Partial progress:\n${sections.join('\n')}`;
}

/**
 * Test API connection
 */
export async function testConnection() {
  try {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: config.api.model,
      messages: [{ role: 'user', content: 'Say "PHANTOM online" in exactly 2 words.' }],
      max_tokens: 20,
    }, { timeout: 5000 });
    return { success: true, message: response.choices[0]?.message?.content || 'Connected', model: config.api.model };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
