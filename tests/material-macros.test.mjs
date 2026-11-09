import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePreset, processOutput } from '../lib/preset.mjs';
import { compilerMaterials } from '../lib/materials.mjs';
import { materials, preset } from './fixtures/materials.mjs';

const compile = (document, host) => compilePreset(document, compilerMaterials(host));
const helper = (document, content) => {
  document.extensions.tavern_helper = { scripts: [{ id: 'custom', name: 'custom macros', enabled: true, content }] };
};
const registerCustom = 'registerMacroLike(/{{custom}}/g, () => "宏已展开");';

for (const source of ['history', 'input', 'worldbook']) {
  test(`plain ST presets retain literal identity macros in ${source}`, () => {
    const host = structuredClone(materials), document = structuredClone(preset);
    const text = `冻结${source}：{{user}} 与 {{char}} 不应展开`;
    if (source === 'history') host.history[2].text = text;
    if (source === 'input') host.input.text = text;
    if (source === 'worldbook') host.context.find(item => item.id === 'worldbook').text = text;
    const before = structuredClone(host);
    const result = compile(document, host);
    assert.ok(result.request.messages.some(message => message.content.includes(text)), 'model request keeps the frozen source verbatim');
    assert.ok(result.request.messages.some(message => message.content === '测试角色与测试玩家'), 'preset identity macros still expand');
    assert.deepEqual(host, before, 'compilation does not mutate the host snapshot');
  });
}

for (const shortHistory of ['c', 'custom']) {
  test(`historical text ${JSON.stringify(shortHistory)} cannot conceal a custom preset macro`, () => {
    const host = structuredClone(materials), document = structuredClone(preset);
    host.history = [{ role: 'user', text: shortHistory }];
    document.prompts[1].content = '{{custom}}';
    helper(document, registerCustom);
    const result = compile(document, host);
    assert.ok(result.request.messages.some(message => message.content === '宏已展开'));
    assert.ok(result.request.messages.some(message => message.content === shortHistory));
    assert.ok(result.request.messages.every(message => !message.content.includes('{{custom}}')));

    helper(document, 'console.info("no macro handler");');
    assert.throws(() => compile(document, host), /未解析预设宏/, 'an unresolved preset macro must still stop dispatch');
  });
}

test('identical historical and preset macros retain their separate meaning in either prompt order', () => {
  for (const historyFirst of [false, true]) {
    const host = structuredClone(materials), document = structuredClone(preset);
    host.history = [{ role: 'assistant', text: '{{custom}}' }];
    document.prompts[1].content = '{{custom}}';
    if (historyFirst) {
      document.prompt_order[0].order = ['chatHistory', 'identity', 'normal', 'regenerate']
        .map(identifier => ({ identifier, enabled: true }));
    }
    helper(document, registerCustom);
    const result = compile(document, host);
    assert.ok(result.request.messages.some(message => message.role === 'assistant' && message.content === '{{custom}}'), 'historical literal macro remains unchanged');
    assert.ok(result.request.messages.some(message => message.role === 'system' && message.content === '宏已展开'), 'the identical preset template still expands');
  }
});

test('chat macros preserve literal identity macros returned from the current input', () => {
  for (const withHelper of [false, true]) {
    const host = structuredClone(materials), document = structuredClone(preset);
    host.input.text = '本轮输入字面 {{user}} 与 {{char}}';
    document.prompts[1].content = '引述本轮：{{lastUserMessage}}';
    if (withHelper) helper(document, 'void 0;');
    const result = compile(document, host);
    assert.ok(result.request.messages.some(message => message.content === '引述本轮：' + host.input.text));
    assert.ok(result.request.messages.some(message => message.content === host.input.text));
  }
});

test('chat material copied through variables stays opaque without hiding preset-authored variable macros', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  host.input.text = '输入原文 {{user}} 与 {{custom}}';
  document.prompts[1].content = '{{setvar::copy::{{lastUserMessage}}}}引用：{{getvar::copy}}';
  helper(document, registerCustom);
  assert.ok(compile(document, host).request.messages.some(message => message.content === '引用：' + host.input.text));

  document.prompts[1].content = '{{setvar::copy::{{lastUserMessage}}}}{{addvar::copy:: / 模板：{{custom}}}}引用：{{getvar::copy}}';
  assert.ok(compile(document, host).request.messages.some(message => message.content === '引用：' + host.input.text + ' / 模板：宏已展开'));
});

test('a raw hook can introduce a new helper macro without short history concealing it', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  host.history = [{ role: 'user', text: 'c' }];
  helper(document, registerCustom);
  document.extensions.SPreset = { FinalRequestProcessing: { enabled: true,
    script: '({request}) => { request.messages.push({role:"system",content:"{{custom}}"}); return request; }' } };
  const result = compile(document, host);
  assert.equal(result.request.messages.at(-1).content, '宏已展开');
  assert.ok(result.request.messages.some(message => message.content === 'c'));
});

test('identity macros introduced by scripts do not re-expand the substituted name', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  host.identities.playerName = '玩家字面 {{char}}';
  helper(document, `eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, request => {
    request.messages.push({role:'system', content:'脚本身份：{{user}}'});
  });`);
  assert.equal(compile(document, host).request.messages.at(-1).content, '脚本身份：' + host.identities.playerName);
});

test('raw hooks may edit template prose without concealing an unresolved custom macro', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  host.history = [{ role: 'user', text: 'c' }];
  document.prompts[1].content = '旧前缀 {{custom}}';
  document.extensions.SPreset = { FinalRequestProcessing: { enabled: true, script: `({request}) => {
    for (const message of request.messages) message.content = message.content.replace('旧前缀 ', '新前缀 ');
    return request;
  }` } };
  helper(document, registerCustom);
  assert.ok(compile(document, host).request.messages.some(message => message.content === '新前缀 宏已展开'));
  helper(document, 'void 0;');
  assert.throws(() => compile(document, host), /未解析预设宏/);
});

test('raw hooks can merge repeated source messages without treating their references as ambiguous', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  const repeated = '重复材料 {{user}} {{char}}';
  host.history = [{ role: 'user', text: repeated }, { role: 'assistant', text: repeated }];
  host.input.text = repeated;
  document.extensions.SPreset = { FinalRequestProcessing: { enabled: true,
    script: '({request}) => ({...request, messages: [{role:"user",content:request.messages.map(m=>m.content).join("\\n")} ]})' } };
  helper(document, 'void 0;');
  const result = compile(document, host);
  assert.equal(result.request.messages[0].content.split(repeated).length - 1, 3);
  assert.doesNotMatch(JSON.stringify(result.request), /STCONTEXT_MATERIAL_/);
});

test('ChatSquash and raw final hooks preserve short history while helper macros expand before formatting', () => {
  for (const relocate of [false, true]) {
    const host = structuredClone(materials), document = structuredClone(preset);
    const frozen = '[RAW_FINAL_HISTORY] {{user}} {{custom}}';
    host.history = [{ role: 'user', text: 'c' }, { role: 'assistant', text: frozen }, { role: 'user', text: '{{custom}}' }];
    document.prompts[1].content = '{{custom}}';
    document.extensions.SPreset = {
      ChatSquash: { enabled: true, role: 'system' },
      ToolBindings: { identity: { enabled: true, editorMode: 'form', form: {
        name: 'story_body', description: '正文输出', parameters: [{ name: 'body', type: 'string', required: true }],
      } } },
      OutputPreprocessing: { consumeToolCalls: true, toolCallFormatter: {
        enabled: true, script: '({calls}) => JSON.parse(calls[0].arguments).body',
      } },
    };
    if (relocate) document.extensions.SPreset.FinalRequestProcessing = { enabled: true, script: `({request}) => {
      const text = request.messages.map(message => message.content).join('\\n');
      if (!text.split('\\n\\n').includes('c') || !text.includes('[RAW_FINAL_HISTORY] {{user}} {{custom}}')) throw Error('final hook lost the raw history');
      if (text.split('\\n\\n').filter(part => part === '{{custom}}').length !== 2) throw Error('final hook changed an identical template or material');
      request.tools[0].function.description += '\\n' + text;
      request.messages = [{role: 'user', content: '输出正文'}];
      return request;
    }` };
    helper(document, registerCustom + `
      eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, request => {
        for (const tool of request.tools || []) tool.function.description = tool.function.description.replace(/{{custom}}/g, '宏已展开');
      });
    `);
    const compiled = compile(document, host);
    const texts = [...compiled.request.messages.map(message => message.content), ...compiled.request.tools.map(tool => tool.description)];
    assert.ok(texts.some(text => text.includes('宏已展开')));
    assert.ok(texts.some(text => text.includes(frozen)));
    assert.ok(texts.some(text => text.split('\n\n').includes('c')));
    assert.equal(texts.flatMap(text => text.split('\n\n')).filter(part => part === '{{custom}}').length, 1, 'only the historical standalone macro remains literal');
    if (relocate) assert.deepEqual(compiled.request.messages, [{ role: 'user', content: '输出正文' }]);
    const result = processOutput({ document, helperState: compiled.helperState, toolNames: ['story_body'],
      response: { toolCalls: [{ id: 'reply', name: 'story_body', arguments: '{"body":"完整组合正文"}' }] } });
    assert.equal(result.text, '完整组合正文');
  }
});

test('helper tool relocation preserves literal material macros and custom expansion across output replay', () => {
  const host = structuredClone(materials), document = structuredClone(preset);
  const frozen = '历史中的 {{custom}}、{{user}}、{{char}} 都保持原文';
  host.history = [{ role: 'user', text: 'c' }, { role: 'assistant', text: frozen }];
  host.input.text = '本轮原文 {{user}} 与 {{char}}';
  document.prompts[1].content = '{{custom}}';
  helper(document, registerCustom + `
    const original = fetch;
    fetch = async (url, init) => {
      const request = JSON.parse(init.body);
      request.tools = [{type: 'function', function: {
        name: 'story_body', description: request.messages.map(message => message.content).join('\\n'),
        parameters: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']}
      }}];
      request.messages = [{role: 'user', content: 'Return the story_body tool.'}];
      const response = await original(url, {...init, body: JSON.stringify(request)});
      const envelope = await response.json();
      const message = envelope.choices[0].message;
      message.content = JSON.parse(message.tool_calls[0].function.arguments).text;
      delete message.tool_calls;
      return new Response(JSON.stringify(envelope));
    };
  `);
  const compiled = compile(document, host), description = compiled.request.tools[0].description;
  assert.ok(description.includes('宏已展开'));
  assert.ok(description.includes(frozen));
  assert.ok(description.includes(host.input.text));
  assert.doesNotMatch(JSON.stringify(compiled.request), /STCONTEXT_MATERIAL_/);
  const result = processOutput({ document, helperState: compiled.helperState,
    toolNames: ['story_body'], response: { toolCalls: [{ id: 'reply', name: 'story_body', arguments: '{"text":"完整回复正文"}' }] } });
  assert.equal(result.text, '完整回复正文');
});
