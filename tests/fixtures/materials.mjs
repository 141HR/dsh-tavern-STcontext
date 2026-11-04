export const materials = {
  schemaVersion: 1, gameId: 'test', operationId: 'operation', reason: 'normal',
  input: { raw: '原始输入', text: '本轮已处理输入' },
  history: [{ role: 'assistant', text: '完整开场白', turn: 1, greeting: true },
    { role: 'user', text: '历史玩家输入' }, { role: 'assistant', text: '完整历史正文 {{不要再次展开}}', turn: 2 }],
  context: [
    { id: 'character', kind: 'character', text: '已解析人物 {{保持原样}}', source: 'tavern' },
    { id: 'persona', kind: 'persona', text: '玩家人设', source: 'tavern' },
    { id: 'constant', kind: 'worldbook', text: '固定世界书', source: 'tavern' },
    { id: 'worldbook', kind: 'worldbook', text: '激活世界书\n本轮成功检索结果', source: 'tavern' },
    { id: 'rules', kind: 'writing-rules', text: '写作规范', source: 'tavern' },
    { id: 'guide', kind: 'guide', text: '本轮指导', source: 'tavern' },
    { id: 'script', kind: 'script', text: '剧本参考', source: 'tavern' },
    { id: 'other', kind: 'other', text: '其他材料', source: 'tavern' },
  ],
  identities: { characterName: '测试角色', playerName: '测试玩家' },
  state: { variables: { hp: 10 }, messageVariables: { inputCount: 2 }, status: '输入处理后的状态' },
  guidance: '',
};
export const preset = {
  prompts: [{ identifier: 'chatHistory', marker: true },
    { identifier: 'identity', role: 'system', content: '{{char}}与{{user}}' },
    { identifier: 'normal', role: 'system', content: 'normal-only', injection_trigger: ['normal'] },
    { identifier: 'regenerate', role: 'system', content: 'regenerate-only', injection_trigger: ['regenerate'] }],
  prompt_order: [{ character_id: 100001, order: ['identity', 'normal', 'regenerate', 'chatHistory'].map(identifier => ({ identifier, enabled: true })) }],
  extensions: { regex_scripts: [{ id: 'once', placement: [2], findRegex: '/X/g', replaceString: 'XX', markdownOnly: true, promptOnly: true }] },
};
