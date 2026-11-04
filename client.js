window.__ModuleLoader__.load({
  id: 'dsh-tavern-STcontext',
  factory: require => {
    const React = require('react'), h = React.createElement;
    return {
      name: 'dsh-tavern-STcontext',
      inject: ['tavernUi', 'slots'],
      apply(ctx) {
        const ui = ctx.tavernUi, call = (name, args = {}) => ui.callHost('dsh-tavern-stcontext/' + name, args);
        const editableSettings = value => ({ adapter: value?.adapter || 'auto', model: value?.model || null });
        const css = `
.stc-scroll{box-sizing:border-box;flex:1 1 auto;width:100%;height:100%;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
.stc-panel{--stc-surface:var(--dsw-specific-input-major,#fff);--stc-border:var(--dsw-alias-border-l2,#e3e4eb);--stc-muted:var(--dsw-alias-label-secondary,#717583);--stc-accent:var(--dsh-tavern-accent,#5956c9);--stc-soft:var(--dsh-tavern-accent-soft,#eeedf9);--stc-highlight:var(--stc-accent);box-sizing:border-box;width:100%;max-width:1020px;min-width:0;margin:0 auto;padding:24px;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:1.6;container:stcontext / inline-size}
body[data-ds-dark-theme] .stc-panel{--stc-surface:var(--dsw-specific-input-major,#24252d);--stc-border:var(--dsw-alias-border-l2,#3d3e48);--stc-muted:var(--dsw-alias-label-secondary,#afb2c0);--stc-soft:var(--dsh-tavern-accent-soft,#303047);--stc-highlight:#bbb7ff}
.stc-panel *{box-sizing:border-box}
.stc-panel h2,.stc-panel h3,.stc-panel p{margin:0}
.stc-panel h2{font-size:23px;font-weight:650;letter-spacing:-.6px;line-height:1.3}
.stc-panel h3{font-size:15px;font-weight:650}
.stc-panel button,.stc-panel select{font:inherit}
.stc-panel .stc-muted{color:var(--stc-muted);font-size:12px}
.stc-panel .stc-heading{display:flex;align-items:center;gap:12px;min-width:0}
.stc-panel .stc-brand{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:13px;background:var(--stc-soft);color:var(--stc-highlight);font-size:16px;font-weight:750;letter-spacing:-1px}
.stc-panel .stc-header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:22px}
.stc-panel .stc-subtitle{color:var(--stc-muted);font-size:12px;margin-top:4px}
.stc-panel .stc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.stc-panel .stc-between{justify-content:space-between}
.stc-panel .stc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin-bottom:16px}
.stc-panel .stc-card{min-width:0;border:1px solid var(--stc-border);border-radius:14px;background:var(--stc-surface);padding:20px}
.stc-panel .stc-config-card{display:flex;flex-direction:column;gap:16px}
.stc-panel .stc-card-title{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.stc-panel .stc-field{display:flex;flex-direction:column;gap:7px;min-width:0;font-size:12px;font-weight:600}
.stc-panel .stc-select{display:block;width:100%;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--stc-border);border-radius:8px;color:inherit;background:var(--stc-surface);font-weight:400;text-overflow:ellipsis}
.stc-panel .stc-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;max-width:100%;padding:7px 12px;border:1px solid var(--stc-border);border-radius:8px;color:inherit;background:transparent;line-height:1.4;cursor:pointer;transition:background .15s,border-color .15s}
.stc-panel .stc-button:hover:not(:disabled){border-color:var(--stc-accent);background:var(--stc-soft)}
.stc-panel .stc-button:disabled,.stc-panel .stc-select:disabled{opacity:.45;cursor:not-allowed}
.stc-panel .stc-button:focus-visible,.stc-panel .stc-select:focus-visible,.stc-panel summary:focus-visible{outline:2px solid var(--stc-accent);outline-offset:3px}
.stc-panel .stc-primary{background:var(--stc-accent);border-color:var(--stc-accent);color:#fff;font-weight:600;min-height:42px;padding:10px 18px}
.stc-panel .stc-primary:hover:not(:disabled){background:var(--stc-accent);filter:brightness(1.1)}
.stc-panel .stc-quiet{border-color:transparent;font-size:12px;color:var(--stc-muted);padding:5px 8px;min-height:30px}
.stc-panel .stc-danger{color:var(--dsh-tavern-accent-error,#c54f4f)}
.stc-panel .stc-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:6px;background:var(--stc-soft);color:var(--stc-highlight);font-size:11px;white-space:nowrap}
.stc-panel .stc-badge-neutral{background:rgba(128,128,144,.09);color:var(--stc-muted)}
.stc-panel .stc-badge-error{background:rgba(197,79,79,.1);color:var(--dsh-tavern-accent-error,#c54f4f)}
.stc-panel .stc-dot{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
.stc-panel .stc-empty{border:1px dashed var(--stc-border);border-radius:10px;padding:22px 14px;text-align:center}
.stc-panel .stc-empty p+p{margin-top:5px}
.stc-panel .stc-card-footer{margin-top:auto;padding-top:14px;border-top:1px solid var(--stc-border)}
.stc-panel .stc-message{border-radius:9px;padding:10px 13px;font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}
.stc-panel .stc-notice{background:var(--stc-soft)}
.stc-panel .stc-error{background:rgba(197,79,79,.09);border-left:3px solid var(--dsh-tavern-accent-error,#c54f4f)}
.stc-panel .stc-feedback{display:grid;gap:8px;margin-bottom:16px}
.stc-panel .stc-feedback:empty{display:none}
.stc-panel .stc-generation{display:grid;gap:16px;margin-bottom:16px;border-top:3px solid var(--stc-accent)}
.stc-panel .stc-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.stc-panel .stc-details{border-top:1px solid var(--stc-border);padding-top:12px}
.stc-panel summary{cursor:pointer;font-size:12px;color:var(--stc-muted);border-radius:4px;overflow-wrap:anywhere}
.stc-panel details[open]>summary{margin-bottom:12px}
.stc-panel .stc-details-body{display:grid;gap:12px;min-width:0}
.stc-panel .stc-report{margin-bottom:16px;padding:14px 20px}
.stc-panel .stc-report>summary{color:inherit;font-size:13px}
.stc-panel .stc-report>summary .stc-badge{margin-left:10px}
.stc-panel .stc-meta{font-family:ui-monospace,monospace;font-size:11px;color:var(--stc-muted);overflow-wrap:anywhere}
.stc-panel .stc-report ul{margin:0;padding-left:20px;font-size:12px;color:var(--stc-muted)}
.stc-panel .stc-request{display:grid;gap:14px}
.stc-panel .stc-request pre{margin:0;padding:14px;border:1px solid var(--stc-border);border-radius:9px;background:rgba(128,128,144,.05);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:440px;overflow:auto}
.stc-panel .stc-request-name{font-size:12px;color:var(--stc-muted)}
@container stcontext (max-width:480px){.stc-panel .stc-header{align-items:flex-start}
.stc-panel .stc-card{padding:16px}
.stc-panel .stc-actions{align-items:stretch}
.stc-panel .stc-actions>.stc-row{width:100%}
.stc-panel .stc-actions .stc-primary{flex:1}
.stc-panel .stc-header-status{display:none}
.stc-panel .stc-brand{width:36px;height:36px}
.stc-panel h2{font-size:20px}}
@media(max-width:480px){.stc-panel{padding:16px}}
@media(prefers-reduced-motion:reduce){.stc-panel .stc-button{transition:none}}
`;
        function download(name, text) {
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
          const a = document.createElement('a'); a.href = url; a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        function Panel({ gameId, close, settingsPage = false }) {
          const [config, setConfig] = React.useState(null);
          const [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [working, setWorking] = React.useState(false);
          const [settings, setSettings] = React.useState({}), [report, setReport] = React.useState(null);
          const [catalog, setCatalog] = React.useState([]), [modelsLoading, setModelsLoading] = React.useState(false), [modelError, setModelError] = React.useState('');
          const [reasoning, setReasoning] = React.useState({ key: '', efforts: [], loading: false, error: '' });
          const [request, setRequest] = React.useState(''), [requestShown, setRequestShown] = React.useState(false);
          const file = React.useRef(null), alive = React.useRef(true);
          const busy = working;
          async function refresh(resetSettings = true) {
            const value = await call('config');
            if (alive.current) { setConfig(value); if (resetSettings) setSettings(editableSettings(value.settings)); }
          }
          async function saveSettings() {
            const value = await call('settings', editableSettings(settings));
            if (alive.current) { setConfig(current => ({ ...current, ...value })); setSettings(editableSettings(value.settings)); }
          }
          async function refreshModels() {
            setModelsLoading(true); setModelError('');
            try {
              const value = await call('models');
              if (alive.current) setCatalog(value.groups || []);
            } catch (err) { if (alive.current) setModelError(err.message || String(err)); }
            finally { if (alive.current) setModelsLoading(false); }
          }
          React.useEffect(() => {
            alive.current = true;
            refresh().catch(err => { if (alive.current) setError(err.message || String(err)); });
            refreshModels();
            return () => { alive.current = false; };
          }, []);
          async function act(work) {
            setWorking(true); setError(''); setNotice('');
            try { await work(); } catch (err) { if (alive.current) setError(err.message || String(err)); }
            finally { if (alive.current) setWorking(false); }
          }
          async function importFile(selected) {
            if (!selected) return;
            await act(async () => {
              if (selected.size > 2 * 1024 * 1024) throw new Error('预设文件不能超过 2 MB');
              const text = await selected.text(), upload = await call('upload/begin', { name: selected.name, size: text.length });
              for (let index = 0, offset = 0; offset < text.length; index++, offset += 50000) {
                await call('upload/chunk', { id: upload.id, index, text: text.slice(offset, offset + 50000) });
              }
              await call('upload/finish', { id: upload.id });
              await refresh(false); setReport(null); setNotice('预设已导入');
            });
          }
          async function readRequest() {
            let offset = 0, chunks = [], info;
            do {
              const part = await call('request', { gameId, offset });
              if (!part) throw new Error('本次会话还没有已编译请求，请先生成正文');
              if (info && info.createdAt !== part.createdAt) throw new Error('请求已更新，请重新打开预览');
              info = part; chunks.push(part.text); offset += part.text.length;
            } while (offset < info.total);
            const text = chunks.join('');
            setReport(info.report); setRequest(text); setRequestShown(true);
          }
          const selected = config?.presets.find(item => item.id === config.activeId);
          const activeReport = report || selected?.report;
          const modelKey = settings.model?.provider && settings.model?.model
            ? JSON.stringify({ provider: settings.model.provider, model: settings.model.model }) : '';
          const modelOptions = catalog.flatMap(group => group.models.map(model => ({
            key: JSON.stringify({ provider: group.provider, model: model.id }),
            label: group.providerName + ' · ' + model.name, efforts: model.efforts || [],
          })));
          const selectedModel = modelOptions.find(model => model.key === modelKey);
          React.useEffect(() => {
            let active = true;
            if (modelKey) {
              setReasoning({ key: modelKey, efforts: [], loading: true, error: '' });
              call('model-reasoning', JSON.parse(modelKey)).then(value => {
                if (!active) return;
                const efforts = value.efforts || [];
                setReasoning({ key: modelKey, efforts, loading: false, error: '' });
                // A confirmed lack of levels must not keep a stale saved override.
                if (!efforts.length) setSettings(current => {
                  if (!current.model?.reasoningEffort || JSON.stringify({ provider: current.model.provider, model: current.model.model }) !== modelKey) return current;
                  const { reasoningEffort, ...model } = current.model;
                  return { ...current, model };
                });
              }, err => {
                if (active) setReasoning({ key: modelKey, efforts: [], loading: false, error: err.message || String(err) });
              });
            }
            return () => { active = false; };
          }, [modelKey, catalog]);
          const efforts = reasoning.key === modelKey ? reasoning.efforts : [];
          const reasoningLoading = !!modelKey && (modelsLoading || reasoning.key !== modelKey || reasoning.loading);
          const reasoningError = reasoning.key === modelKey ? reasoning.error : '';
          const settingsDirty = config && JSON.stringify(editableSettings(settings)) !== JSON.stringify(editableSettings(config.settings));
          const ready = !!(config?.hostReady && selected && modelKey && !reasoningLoading);
          const message = (text, kind = 'notice', role = 'status') => h('p', { className: 'stc-message stc-' + kind, role }, text);
          const badge = (text, tone = '') => h('span', { className: 'stc-badge' + (tone ? ' stc-badge-' + tone : '') }, text);
          // Sidebar tabs and overlays have a bounded host area; settings already owns its scroll area.
          return h('div', { className: settingsPage ? 'stc-settings' : 'stc-scroll' },
            h('style', null, css),
            h('div', { className: 'stc-panel' },
            h('header', { className: 'stc-header' },
              h('div', { className: 'stc-heading' }, h('span', { className: 'stc-brand', 'aria-hidden': true }, 'ST'),
                h('div', null, h('h2', null, 'STcontext'), h('p', { className: 'stc-subtitle' }, '完整可见历史 · 独立模型生成'))),
              h('div', { className: 'stc-row' }, h('span', { className: 'stc-header-status' }, badge(!config ? '加载中' : ready ? '配置就绪' : '待配置', ready ? '' : 'neutral')),
                close && h('button', { className: 'stc-button stc-quiet', onClick: close }, '关闭'))),
            h('div', { className: 'stc-feedback' }, error && message(error, 'error', 'alert'), notice && message(notice),
              config?.hostReady === false && message('宿主尚未提供插件正文生成接口，请更新上游 DSH Tavern。预设仍可导入保存。', 'error', 'alert')),
            h('div', { className: 'stc-grid' },
            h('section', { className: 'stc-card stc-config-card', 'aria-label': '预设管理' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '预设'), h('p', { className: 'stc-muted' }, '管理叙事规则与上下文组织方式')),
                h('button', { className: 'stc-button', disabled: busy, onClick: () => file.current?.click() }, '导入 JSON')),
              h('input', { ref: file, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: event => { const selectedFile = event.target.files?.[0]; event.target.value = ''; importFile(selectedFile); } }),
              !selected && h('div', { className: 'stc-empty' }, h('p', null, config ? '还没有选定预设' : '正在读取预设…'), h('p', { className: 'stc-muted' }, '导入 SillyTavern 预设 JSON，即可开始配置。')),
              h('label', { className: 'stc-field' }, '当前预设',
                h('select', { className: 'stc-select', 'aria-label': '当前预设', value: config?.activeId || '', disabled: busy || !config?.presets.length,
                  onChange: event => { const id = event.target.value; act(async () => { await call('select', { id }); setReport(null); await refresh(false); }); } },
                  h('option', { value: '', disabled: true }, '请选择导入的预设'),
                  ...(config?.presets || []).map(item => h('option', { key: item.id, value: item.id }, item.name)))),
              selected && h('div', { className: 'stc-row' }, badge((selected.report?.enabledPrompts || 0) + ' 项提示词', 'neutral'), badge((selected.report?.regexCount || 0) + ' 条正则', 'neutral')),
              h('details', { className: 'stc-details' }, h('summary', null, '预设适配'),
                h('div', { className: 'stc-details-body' }, h('label', { className: 'stc-field' }, '请求模式',
                  h('select', { className: 'stc-select', 'aria-label': '请求模式', value: settings.adapter || 'auto', disabled: busy || !config, onChange: event => setSettings({ ...settings, adapter: event.target.value }) },
                    h('option', { value: 'auto' }, '自动识别已适配脚本'), h('option', { value: 'st' }, '标准 ST（忽略脚本行为）'))),
                  h('p', { className: 'stc-muted' }, '默认自动识别。预设包含未适配脚本时，可选择标准 ST 模式。'))),
              h('div', { className: 'stc-card-footer stc-row stc-between' }, h('span', { className: 'stc-muted' }, 'JSON · 最大 2 MB'),
                h('div', { className: 'stc-row' },
                  h('button', { className: 'stc-button stc-quiet', disabled: !selected || working, onClick: () => act(async () => { const value = await call('export', { id: selected.id }); download(value.name, value.text); }) }, '导出原文件'),
                  h('button', { className: 'stc-button stc-quiet stc-danger', disabled: !selected || busy, onClick: () => act(async () => { await call('remove', { id: selected.id }); await refresh(false); setReport(null); }) }, '移除')))),
            h('section', { className: 'stc-card stc-config-card', 'aria-label': '模型设置' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '正文模型'), h('p', { className: 'stc-muted' }, '用于正文生成与重生成')), badge('独立配置')),
              h('label', { className: 'stc-field' }, '插件正文模型',
                h('select', { 'aria-label': '插件正文模型', className: 'stc-select', value: modelKey, disabled: busy || !config || modelsLoading,
                  onChange: event => setSettings({ ...settings, model: event.target.value ? JSON.parse(event.target.value) : null }) },
                  h('option', { value: '' }, '请选择模型'),
                  modelKey && !selectedModel && h('option', { value: modelKey }, settings.model.provider + ' · ' + settings.model.model + '（未在列表中找到）'),
                  ...modelOptions.map(model => h('option', { key: model.key, value: model.key }, model.label)))),
              h('label', { className: 'stc-field' }, '推理等级',
                h('select', { 'aria-label': '推理等级', className: 'stc-select', value: settings.model?.reasoningEffort || '', disabled: busy || !modelKey || reasoningLoading || !!reasoningError || !efforts.length,
                  onChange: event => { const model = { ...settings.model }; if (event.target.value) model.reasoningEffort = event.target.value; else delete model.reasoningEffort; setSettings({ ...settings, model }); } },
                  h('option', { value: '' }, '模型默认'),
                  settings.model?.reasoningEffort && !efforts.some(item => item.id === settings.model.reasoningEffort)
                    && h('option', { value: settings.model.reasoningEffort }, settings.model.reasoningEffort + '（未在列表中找到）'),
                  ...efforts.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
              h('p', { className: 'stc-muted', role: 'status' }, !modelKey ? '选择模型后显示其支持的推理等级。' : reasoningLoading ? '正在读取推理等级…'
                : reasoningError ? '暂时无法确认该模型的推理等级，已保留当前设置。'
                : efforts.length ? '仅列出该模型支持的等级；模型默认不指定推理等级。' : '该模型未提供可选推理等级，使用模型默认。'),
              reasoningError && message(reasoningError, 'error', 'alert'),
              h('div', { className: 'stc-row stc-between' }, h('p', { className: 'stc-muted' }, '沿用 DSH 已配置的服务商'),
                h('button', { className: 'stc-button stc-quiet', disabled: busy || modelsLoading, onClick: refreshModels }, modelsLoading ? '正在读取模型…' : '刷新模型列表')),
              !modelKey && message('请先选择插件正文模型。旧版前台/后台跟随设置需重新选择。'),
              !modelsLoading && !modelOptions.length && message('暂无可选文本模型，请先在 DSH 配置模型服务商，再刷新列表。'),
              modelError && message(modelError, 'error', 'alert'),
              ...catalog.filter(group => group.error).map(group => h('p', { key: group.provider, className: 'stc-message stc-error', role: 'alert' }, group.providerName + '：' + group.error)),
              h('div', { className: 'stc-card-footer stc-row stc-between' }, h('span', { className: 'stc-muted', role: 'status' }, settingsDirty ? '有未保存的更改' : '设置对所有会话生效'),
                h('button', { className: 'stc-button', disabled: busy || !config || reasoningLoading, onClick: () => act(async () => { await saveSettings(); setNotice('设置已保存'); }) }, '保存设置')))),
            h('section', { className: 'stc-card stc-generation', 'aria-label': '使用说明' },
              h('h3', null, '正文生成'),
              h('p', { className: 'stc-muted' }, '先保存预设与模型设置，再在「设置 → DSH Tavern → 剧情」选择 STcontext 和「插件直接生成」。如需前台模型先查世界书，选择「前台检索后由插件生成」。本局设置可覆盖全局选择。'),
              h('p', { className: 'stc-muted' }, '使用宿主的发送、重生成、失败重试和停止按钮。生成进度及错误由宿主显示；提交后结算失败时，在宿主中重试结算。'),
              h('p', { className: 'stc-muted' }, '预设与模型在操作开始时冻结；生成途中保存更改只影响下一次操作。'),
              gameId ? h('div', { className: 'stc-actions' },
                h('button', { className: 'stc-button stc-quiet', disabled: working, onClick: () => act(readRequest) }, '查看本次请求'))
                : h('p', { className: 'stc-muted' }, '打开游戏后，通过侧栏「＋ → STcontext」或输入框上方的「STcontext」查看本次请求。')),
            activeReport && h('details', { className: 'stc-card stc-report', key: (selected?.id || '') + (activeReport.blockers?.length ? '-blocked' : ''), open: activeReport.blockers?.length ? true : undefined },
              h('summary', null, '兼容报告', badge(activeReport.blockers?.length ? activeReport.blockers.length + ' 项待处理' : activeReport.warnings?.length ? activeReport.warnings.length + ' 项提示' : '检查通过', activeReport.blockers?.length ? 'error' : 'neutral')),
              h('div', { className: 'stc-details-body' },
                h('p', { className: 'stc-meta' }, '顺序 ' + activeReport.order + ' · ' + activeReport.protocol),
                ...(activeReport.blockers || []).map((text, index) => h('p', { key: 'b' + index, className: 'stc-message stc-error', role: 'alert' }, text)),
                h('ul', null, ...(activeReport.warnings || []).map((text, index) => h('li', { key: index }, text))),
                activeReport.historyRules?.length > 0 && h('details', null, h('summary', null, '不对历史正文重复执行的规则'), h('ul', null, ...activeReport.historyRules.map(rule => h('li', { key: rule.index }, rule.name)))),
                selected && h('p', { className: 'stc-meta' }, 'SHA-256：' + selected.digest))),
            requestShown && h('section', { className: 'stc-card stc-request', 'aria-label': '请求预览' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '请求预览'), h('p', { className: 'stc-request-name' }, 'stcontext-request.json')),
                h('div', { className: 'stc-row' }, h('button', { className: 'stc-button', onClick: () => download('stcontext-request.json', request) }, '下载完整请求'), h('button', { className: 'stc-button stc-quiet', onClick: () => setRequestShown(false) }, '收起'))),
              h('pre', null, request))));
        }
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-tavern-stcontext', order: 115, label: () => 'STcontext',
        }, () => h(Panel, { settingsPage: true }))), 'STcontext: settings section');
        ui.registerPanel({ id: 'st-context', title: 'STcontext', render: ({ gameId }) => h(Panel, { gameId }) });
        ui.registerComposerAction({
          id: 'regenerate', label: 'STcontext',
          run: async ({ gameId }) => {
            ui.openOverlay({ gameId, render: ({ close }) => h(Panel, { gameId, close }) });
          },
        });
      },
    };
  },
});
