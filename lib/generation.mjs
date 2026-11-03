import { randomUUID } from 'node:crypto'

const fail = (code, text) => Object.assign(new Error(text), { code })
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const positive = value => Number.isSafeInteger(value) && value > 0

/** Read the configured route through public DSH / Tavern services only. */
export async function selectGenerationModel(ctx, gameId, slot) {
  const model = slot === 'background'
    ? await ctx.tavern.backgroundModel({ gameId })
    : ctx.agents.get(gameId)?.model?.current();
  if (!model?.provider || !model?.model) throw new Error('当前会话没有可用模型，请先选择模型');
  return { provider: model.provider, model: model.model,
    ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }) };
}

/** Plugin-owned one-shot call through DSH, without Session history or an agent loop. */
export function createDshGeneration({ llm, selection, meter }) {
  return async function runIsolated({ gameId, request, signal }) {
    signal?.throwIfAborted()
    if (!object(request)) throw new TypeError('独立生成需要请求对象')
    const allowed = new Set(['messages', 'tools', 'toolChoice', 'temperature', 'maxTokens', 'model', 'contextLimit'])
    for (const key of Object.keys(request)) if (!allowed.has(key)) throw new Error('独立生成不支持请求字段：' + key)
    if (!Array.isArray(request.messages) || !request.messages.length) throw new Error('独立生成需要完整 messages')
    const messages = request.messages.map(message => {
      if (!object(message) || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('独立生成仅接受 system/user/assistant 文本消息')
      return { id: randomUUID(), role: message.role, content: [{ type: 'text', text: message.content }], source: { kind: 'plugin:dsh-tavern-STcontext' } }
    })
    const tools = request.tools ?? []
    if (!Array.isArray(tools) || tools.length > 16) throw new Error('独立生成最多支持 16 个输出工具')
    const names = new Set()
    for (const tool of tools) {
      if (!object(tool) || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(tool.name) || names.has(tool.name)
        || typeof tool.description !== 'string' || !object(tool.parameters) || tool.parameters.type !== 'object'
        || Object.keys(tool).some(key => !['name', 'description', 'parameters'].includes(key))) throw new Error('独立生成工具定义无效')
      names.add(tool.name)
    }
    // The DSH provider-neutral call contract has no forced-tool-choice field.
    // Do not pretend to forward unsupported controls to every adapter.
    if (request.toolChoice !== undefined && request.toolChoice !== 'auto' && !(request.toolChoice === 'none' && !tools.length)) {
      throw fail('STCONTEXT_TOOL_CHOICE_UNSUPPORTED', '当前 DSH 独立请求支持自动工具选择；不支持强制工具选择')
    }
    if (request.model !== undefined && !['foreground', 'background'].includes(request.model)) throw new Error('model 只能是 foreground 或 background')
    if (request.maxTokens !== undefined && !positive(request.maxTokens)) throw new Error('maxTokens 必须是正整数')
    if (request.contextLimit !== undefined && !positive(request.contextLimit)) throw new Error('contextLimit 必须是正整数')
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) throw new Error('temperature 必须在 0 到 2 之间')
    const model = await selection(gameId, request.model || 'foreground')
    if (!model?.provider || !model?.model) throw new Error('当前会话没有可用模型')
    const config = { ...model }
    if (request.maxTokens !== undefined) config.maxTokens = request.maxTokens
    if (request.temperature !== undefined && model.provider !== 'openai-codex') config.temperature = request.temperature
    const estimateText = text => Math.max(Math.ceil(Buffer.byteLength(text, 'utf8') / 3),
      Number(meter?.estimateMessage?.({ role: 'system', content: [{ type: 'text', text }] })) || 0)
    const estimatedInputTokens = messages.reduce((sum, message) => sum + estimateText(message.content[0].text) + 12, 0)
      + estimateText(JSON.stringify(tools)) + tools.length * 32
    // Bind the budget to the exact adapter snapshot that will dispatch this
    // request. A separate capability lookup can race a provider reload.
    const prepared = await llm.prepareCall(config, signal, (controls, info) => {
      const modelLimit = info?.context?.contextWindow
      const contextLimit = positive(modelLimit) ? Math.min(modelLimit, request.contextLimit ?? modelLimit) : request.contextLimit
      if (!positive(contextLimit)) throw fail('STCONTEXT_CONTEXT_CAPACITY_UNKNOWN', '无法确定模型上下文容量，请在插件中设置上下文上限')
      const reserve = controls.maxTokens ?? info?.defaultMaxTokens ?? 8192
      if (!positive(reserve)) throw new Error('模型输出预算无效')
      if (estimatedInputTokens + reserve + Math.max(128, Math.ceil(contextLimit * 0.01)) > contextLimit) {
        throw fail('STCONTEXT_CONTEXT_OVERFLOW', `完整上下文估算 ${estimatedInputTokens} token，输出预留 ${reserve}，超过模型窗口 ${contextLimit}；未截断历史或发送请求`)
      }
      return { ...controls, maxTokens: reserve }
    })
    signal?.throwIfAborted()
    const blocks = new Map()
    let finishReason, usage, received = 0
    const options = { ...prepared.config, messages, system: '', tools: structuredClone(tools), ...(signal ? { signal } : {}) }
    for await (const chunk of prepared.stream(options)) {
      signal?.throwIfAborted()
      const index = chunk.index ?? 0
      if (chunk.type === 'text-delta') {
        const prior = blocks.get(index)
        blocks.set(index, { type: 'text', text: (prior?.text || '') + chunk.text })
        received += Buffer.byteLength(chunk.text || '')
      } else if (chunk.type === 'tool-call-delta') {
        const prior = blocks.get(index)
        blocks.set(index, { type: 'tool-call', id: chunk.id || prior?.id, name: chunk.name || prior?.name,
          arguments: (prior?.arguments || '') + (chunk.argumentsDelta || '') })
        received += Buffer.byteLength(chunk.argumentsDelta || '')
      } else if (chunk.type === 'block-end' && ['text', 'tool-call'].includes(chunk.block?.type)) {
        blocks.set(index, structuredClone(chunk.block))
        received += Buffer.byteLength(JSON.stringify(chunk.block))
      } else if (chunk.type === 'finish') finishReason = chunk.reason
      else if (chunk.type === 'usage') usage = structuredClone(chunk.usage ?? chunk)
      if (received > 8 * 1024 * 1024) throw new Error('模型输出超过 8 MB，未采用不完整正文')
    }
    signal?.throwIfAborted()
    if (!['stop', 'tool-calls'].includes(finishReason?.kind)) {
      throw fail('STCONTEXT_GENERATION_INCOMPLETE', finishReason?.kind === 'max-tokens'
        ? '模型输出达到 token 上限，未采用不完整正文' : '独立生成未完整完成：' + (finishReason?.failure?.message || finishReason?.kind || '没有结束回执'))
    }
    const output = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, block]) => block)
    const text = output.filter(block => block.type === 'text').map(block => block.text).join('')
    const toolCalls = output.filter(block => block.type === 'tool-call').map(({ id, name, arguments: args }) => {
      if (!names.has(name)) throw new Error('模型返回了未声明的输出工具：' + name)
      if (typeof args === 'string') { try { JSON.parse(args) } catch { throw new Error('模型工具参数不是完整 JSON，未采用不完整正文') } }
      else if (!object(args)) throw new Error('模型工具参数无效')
      return { id, name, arguments: args }
    })
    if (!text.trim() && !toolCalls.length) throw new Error('模型返回为空')
    return { text, toolCalls, finishReason: finishReason.kind, usage, model: structuredClone(model), estimatedInputTokens }
  }
}
