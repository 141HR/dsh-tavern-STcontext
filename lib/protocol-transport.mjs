import { toolPolicy, toolSignature } from './request.mjs';
import manifest from '../package.json' with { type: 'json' };

const object = v => v && typeof v === 'object' && !Array.isArray(v);
const fail = text => Object.assign(new Error(text), { code: 'STCONTEXT_PROTOCOL_ROUTE_UNSUPPORTED' });
const MAX_BYTES = 8 * 1024 * 1024;
const serialize = body => {
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('最终提供商请求超过 8 MiB');
  return json;
};

// settings.describe() may expose default/undefined fields as well as saved
// overrides. Merge only defined values; a model's empty defaults must not erase
// provider requirements. Classify known inactive options by meaning, not truthiness.
function resolveCompat(...layers) {
  const result = {}, unsupported = [];
  for (const layer of layers) {
    if (layer == null) continue;
    if (!object(layer)) throw fail('服务商 compat 必须是配置对象');
    for (const [key, value] of Object.entries(layer)) if (value !== undefined) result[key] = value;
  }
  const booleans = new Set(['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming',
    'supportsFinishReason', 'supportsStrictMode', 'requiresToolResultName', 'requiresAssistantAfterToolResult',
    'requiresReasoningContentOnAssistantMessages', 'requiresThinkingAsText', 'supportsLongCacheRetention']);
  // No reasoning blocks are accepted in historical input; requiresThinkingAsText
  // has nothing to convert. Cache capability alone requests no cache markers.
  const disabledOnly = new Set(['supportsThinkingTokenBudget', 'supportsOpenAIGrammarTools', 'supportsMidConvoSystemMessages',
    'supportsMidConvoToolAdditions', 'zaiToolStream', 'sendSessionAffinityHeaders']);
  const emptyOnly = new Set(['chatTemplateKwargs', 'chatTemplateArgs', 'openRouterRouting', 'vercelGatewayRouting']);
  for (const [key, value] of Object.entries(result)) {
    if (booleans.has(key) && typeof value === 'boolean') continue;
    if (disabledOnly.has(key) && value === false) continue;
    if (emptyOnly.has(key) && object(value) && !Object.keys(value).length) continue;
    if (key === 'thinkingFormat' && value === 'openai') continue;
    if (key === 'maxTokensField' && ['max_tokens', 'max_completion_tokens'].includes(value)) continue;
    if (key === 'vllmPriority' && Number.isSafeInteger(value)) continue;
    // Session affinity is irrelevant to this isolated call without a session id.
    if (key === 'sessionAffinityFormat' && ['openai', 'openrouter'].includes(value) && result.sendSessionAffinityHeaders !== true) continue;
    unsupported.push('compat.' + key);
  }
  if (unsupported.length) throw fail('当前服务商含兼容发送尚未实现或取值无效的选项：' + unsupported.join('、') + '；未发送请求');
  return result;
}

// Read only public service interfaces. Connection facts never enter a Worker,
// preview, preset script or returned response. No adapter monkeypatching.
export function createProtocolTransport(ctx, { fetchImpl = globalThis.fetch } = {}) {
  const snapshot = provider => {
    const entries = ctx.llm.listConfigurableProviders?.();
    const entry = entries?.find(e => e.provider === provider);
    const descriptor = ctx.get('settings')?.describe()?.find(d => d.ns === entry?.settingsNs);
    const profile = entry?.settingsPath?.reduce((v, key) => object(v) && Object.hasOwn(v, key) ? v[key] : undefined, descriptor?.value);
    if (!entry || !object(profile)) throw fail('扩展工具协议需要可读取的服务商配置（llm.listConfigurableProviders / settings.describe）');
    return structuredClone({ entry, profile, revision: descriptor.revision });
  };
  return {
    capture(model) {
      const captured = snapshot(model.provider), { entry, profile } = captured;
      // A catalog may select different APIs/endpoints for different models.
      // Require explicit route overrides, except the single native Gemini API.
      const api = profile.api || (model.provider === 'google' ? 'google-generative-ai' : undefined);
      const baseURL = profile.baseURL || (model.provider === 'google' ? entry.defaultBaseURL : undefined);
      if (!['openai-completions', 'google-generative-ai'].includes(api) || !baseURL) throw fail('工具选择/签名兼容发送支持明确配置 api 与 baseURL 的 openai-completions 或 google-generative-ai 服务商；其他协议不会降级发送');
      if (['openai-codex', 'github-copilot', 'google-vertex', 'azure'].includes(model.provider)) throw fail('扩展工具协议暂不支持此服务商的专用认证流程');
      let url;
      try { url = new URL(baseURL); } catch { throw fail('服务商 baseURL 无效'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('服务商 baseURL 必须是无用户信息、查询或片段的 HTTP(S) 地址');
      const modelProfile = profile.models?.find(m => m.id === model.model) || profile.modelOverrides?.[model.model] || {};
      const compat = resolveCompat(profile.compat, modelProfile.compat);
      if (profile.cacheRetention && profile.cacheRetention !== 'none' || profile.transport && !['auto', 'sse'].includes(profile.transport)) throw fail('兼容发送不支持当前缓存/传输配置');
      const route = { api, baseURL: url.href.replace(/\/$/, ''), compat, reasoningEfforts: modelProfile.reasoningEfforts,
        thinkingBudgets: profile.thinkingBudgets, timeoutMs: profile.timeoutMs || profile.streamIdleTimeoutMs || 300000 };
      return {
        verify() {
          if (JSON.stringify(snapshot(model.provider)) !== JSON.stringify(captured)) throw fail('服务商配置在模型预算检查期间发生变化，请重新生成');
        },
        // Budget the exact provider payload (including signature metadata).
        serialize(request, controls) { return serialize(buildProtocolBody(route, request, controls)); },
        async *stream(request, controls, signal) {
          const body = serialize(buildProtocolBody(route, request, controls));
          const refs = profile.apiKeyEnv ? [profile.apiKeyEnv] : entry.nativeAuth?.env || [];
          let key;
          for (const ref of refs) {
            key = (await ctx.get('credentials')?.resolve(ref))?.value;
            if (key) break;
          }
          if (key !== undefined && (typeof key !== 'string' || !key.trim() || /[^\x21-\x7e]/.test(key.trim()))) throw fail('服务商 API Key 格式无效');
          const headers = new Headers(profile.headers || {});
          if (key) headers.set(api === 'google-generative-ai' ? 'x-goog-api-key' : 'authorization', api === 'google-generative-ai' ? key.trim() : 'Bearer ' + key.trim());
          if (!headers.has('authorization') && !headers.has('x-goog-api-key')) throw fail('兼容发送需要 credentials 服务可解析的 API Key 或已配置的认证头；不复用 OAuth 登录或读取凭据文件');
          headers.set('content-type', 'application/json');
          headers.set('accept', 'application/json');
          headers.set('user-agent', `${manifest.name}/${manifest.version} (+https://github.com/koabop/dsh-tavern-STcontext)`);
          const endpoint = route.baseURL + (api === 'openai-completions' ? '/chat/completions' : '/models/' + encodeURIComponent(controls.model.replace(/^models\//, '')) + ':generateContent');
          const operation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(route.timeoutMs)]);
          operation.throwIfAborted();
          let response;
          try { response = await fetchImpl(endpoint, { method: 'POST', headers, body, signal: operation, redirect: 'error' }); }
          catch { operation.throwIfAborted(); throw new Error('兼容模型请求连接失败；未重试或切换发送路径'); }
          if (!response.ok) { await response.body?.cancel(); throw new Error('兼容模型请求被服务商拒绝（HTTP ' + response.status + '）；未重试，未删除协议字段'); }
          const value = await readJson(response, operation);
          yield* protocolChunks(api, value);
        },
      };
    },
  };
}

function reasoningConfig(route, controls) {
  const effort = controls.reasoningEffort;
  if (effort === undefined) return undefined;
  const declared = route.reasoningEfforts;
  if (declared === false || (object(declared) && !Object.hasOwn(declared, effort))) throw fail('服务商配置未声明当前推理强度');
  const value = object(declared) ? declared[effort] : effort;
  if (route.api === 'openai-completions') {
    if (route.compat?.supportsReasoningEffort === false) throw fail('当前服务商不接受 reasoning_effort');
    if (value == null || value === '' || value === 'off') return undefined;
    return { reasoning_effort: value };
  }
  if (/^gemini-3([.-]|$)/.test(controls.model)) {
    if (!['minimal', 'low', 'medium', 'high'].includes(value)) throw fail('此 Gemini 模型的推理强度无法转换');
    return { thinkingConfig: { thinkingLevel: value } };
  }
  const budget = effort === 'off' ? 0 : route.thinkingBudgets?.[effort];
  if (!Number.isSafeInteger(budget) || budget < 0) throw fail('此 Gemini 模型的推理强度需要服务商明确配置 thinkingBudgets');
  return { thinkingConfig: { thinkingBudget: budget } };
}

export function buildProtocolBody(route, request, controls) {
  const policy = toolPolicy(request), tools = request.tools || [];
  if (route.api === 'openai-completions') {
    let choice = { AUTO: 'auto', NONE: 'none', ANY: 'required' }[policy.mode];
    if (policy.mode === 'ANY' && policy.names.length === 1) choice = { type: 'function', function: { name: policy.names[0] } };
    else if (policy.mode === 'ANY' && policy.names.length !== tools.length) throw fail('OpenAI 兼容发送不能表达此 allowedFunctionNames 子集');
    const cap = route.compat?.maxTokensField || 'max_tokens';
    if (!['max_tokens', 'max_completion_tokens'].includes(cap)) throw fail('不支持的输出预算字段');
    const messages = [];
    const calls = new Map();
    for (const message of structuredClone(request.messages)) {
      if (route.compat?.requiresAssistantAfterToolResult && messages.at(-1)?.role === 'tool' && message.role === 'user') {
        messages.push({ role: 'assistant', content: 'Tool results received.' });
      }
      for (const call of message.tool_calls || []) calls.set(call.id, call.function.name);
      if (message.role === 'tool' && route.compat?.requiresToolResultName) message.name = calls.get(message.tool_call_id);
      if (message.role === 'assistant' && message.content == null && route.compat?.requiresAssistantAfterToolResult) message.content = '';
      messages.push(message);
    }
    if (route.compat?.requiresReasoningContentOnAssistantMessages) {
      for (const message of messages) if (message.role === 'assistant') message.reasoning_content = '';
    }
    return { model: controls.model, messages, stream: false, [cap]: controls.maxTokens,
      ...(route.compat?.supportsStore ? { store: false } : {}),
      ...(route.compat?.vllmPriority === undefined ? {} : { priority: route.compat.vllmPriority }),
      ...(controls.temperature === undefined ? {} : { temperature: controls.temperature }),
      ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: t })), tool_choice: choice } : {}),
      ...reasoningConfig(route, controls) };
  }
  if (route.api !== 'google-generative-ai') throw fail('未实现的兼容发送协议');
  const contents = [], system = [], calls = new Map();
  for (const message of request.messages) {
    if (message.role === 'system') {
      // Moving an in-history system message to the top changes its semantics.
      if (contents.length) throw fail('Gemini 兼容发送不支持历史中途的 system 消息，请在预设中合并');
      system.push({ text: message.content }); continue;
    }
    const parts = [];
    if (message.role === 'tool') {
      let result;
      try { result = JSON.parse(message.content); } catch { result = message.content; }
      parts.push({ functionResponse: { id: message.tool_call_id, name: calls.get(message.tool_call_id), response: object(result) ? result : { result } } });
    } else {
      if (message.content || (!message.tool_calls && message.thoughtSignature)) parts.push({ text: message.content, ...(!message.tool_calls && message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) });
      for (const [index, call] of (message.tool_calls || []).entries()) {
        calls.set(call.id, call.function.name);
        const signature = toolSignature(message, call, index);
        parts.push({ functionCall: { id: call.id, name: call.function.name, args: JSON.parse(call.function.arguments) }, ...(signature ? { thoughtSignature: signature } : {}) });
      }
      if (!parts.length) parts.push({ text: message.content || '' });
    }
    const role = message.role === 'assistant' ? 'model' : 'user';
    // Gemini represents parallel tool responses in one user content.
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
    else contents.push({ role, parts });
  }
  return { contents, ...(system.length ? { systemInstruction: { parts: system } } : {}),
    ...(tools.length ? { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: {
      mode: policy.mode, ...(policy.mode === 'ANY' ? { allowedFunctionNames: policy.names } : {}) } } } : {}),
    generationConfig: { maxOutputTokens: controls.maxTokens,
      ...(controls.temperature === undefined ? {} : { temperature: controls.temperature }), ...reasoningConfig(route, controls) } };
}

async function readJson(response, signal) {
  if (!response.body) throw new Error('模型回包为空');
  const reader = response.body.getReader(), chunks = [];
  let size = 0, finished = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { finished = true; break; }
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('模型回包超过 8 MiB');
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('模型回包不是完整 JSON'); }
  } finally { if (!finished) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function* protocolChunks(api, value) {
  let blocks, reason;
  if (api === 'openai-completions') {
    if (value.error || !Array.isArray(value.choices) || value.choices.length !== 1) throw new Error('模型回包缺少唯一的完整候选');
    const choice = value.choices[0], message = choice.message;
    if (!object(message) || message.refusal) throw new Error('模型拒绝或未返回消息');
    blocks = [];
    if (typeof message.content === 'string' && message.content) blocks.push({ type: 'text', text: message.content });
    else if (message.content != null && message.content !== '') throw new Error('模型返回不支持的正文格式');
    if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw new Error('模型返回无效工具列表');
    for (const call of message.tool_calls || []) {
      if (call.type !== 'function' || !object(call.function)) throw new Error('模型返回无效工具调用');
      blocks.push({ type: 'tool-call', id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    reason = { stop: 'stop', tool_calls: 'tool-calls', length: 'max-tokens' }[choice.finish_reason] || 'error';
  } else {
    if (value.error || value.promptFeedback?.blockReason || !Array.isArray(value.candidates) || value.candidates.length !== 1) throw new Error('Gemini 回包被拦截或缺少唯一候选');
    const candidate = value.candidates[0];
    blocks = [];
    for (const part of candidate.content?.parts || []) {
      if (part.thought === true) continue;
      if (typeof part.text === 'string') blocks.push({ type: 'text', text: part.text });
      else if (object(part.functionCall)) blocks.push({ type: 'tool-call', id: part.functionCall.id, name: part.functionCall.name, arguments: part.functionCall.args });
      else throw new Error('Gemini 返回不支持的正文格式');
    }
    reason = candidate.finishReason === 'STOP' ? (blocks.some(b => b.type === 'tool-call') ? 'tool-calls' : 'stop') : candidate.finishReason === 'MAX_TOKENS' ? 'max-tokens' : 'error';
  }
  for (const [index, block] of blocks.entries()) yield { type: 'block-end', index, block };
  // Provider usage is informational. Host settlement remains outside this call.
  if (value.usage || value.usageMetadata) yield { type: 'usage', usage: value.usage || value.usageMetadata };
  yield { type: 'finish', reason: { kind: reason } };
}
