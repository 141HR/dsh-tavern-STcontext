window.__ModuleLoader__.load({
  id: 'dsh-tavern-STcontext',
  factory: require => {
    const React = require('react'), h = React.createElement;
    return {
      name: 'dsh-tavern-STcontext',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi, call = (name, args = {}) => ui.callHost('dsh-tavern-stcontext/' + name, args);
        const labels = { queued: '排队中', preparing: '准备起点快照', snapshot: '读取完整可见材料', generating: '独立生成中', validating: '校验正文', committing: '替换正文', committed: '正文已提交', syncing: '同步主会话', settling: '重新结算', completed: '已完成', succeeded: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', aborted: '已取消', running: '进行中' };
        const ended = value => !value || ['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'aborted'].includes(value.status);
        const box = { border: '1px solid var(--border-color, #6665)', borderRadius: 10, padding: 14, marginBottom: 12 };
        const button = { padding: '7px 11px', border: '1px solid var(--border-color, #6665)', borderRadius: 7, background: 'var(--background-secondary, transparent)', color: 'inherit', cursor: 'pointer' };
        const field = { boxSizing: 'border-box', width: '100%', padding: 8, color: 'inherit', background: 'var(--background-secondary, transparent)', border: '1px solid #8885', borderRadius: 6 };
        function download(name, text) {
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
          const a = document.createElement('a'); a.href = url; a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        function Panel({ gameId, close }) {
          const [config, setConfig] = React.useState(null), [status, setStatus] = React.useState(null);
          const [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [working, setWorking] = React.useState(false);
          const [settings, setSettings] = React.useState({}), [report, setReport] = React.useState(null);
          const [request, setRequest] = React.useState(''), [requestShown, setRequestShown] = React.useState(false);
          const file = React.useRef(null), alive = React.useRef(true);
          const busy = working || !ended(status);
          const phase = status && ['failed', 'cancelled', 'canceled', 'aborted'].includes(status.status) ? status.status : status?.phase || status?.status;
          const canCancel = !ended(status) && status?.cancellable !== false && !status?.committed && !['committed', 'settling'].includes(status?.phase);
          async function refresh() {
            const value = await call('config');
            if (alive.current) { setConfig(value); setSettings(value.settings || {}); }
          }
          React.useEffect(() => {
            alive.current = true;
            refresh().catch(err => { if (alive.current) setError(err.message || String(err)); });
            return () => { alive.current = false; };
          }, []);
          React.useEffect(() => {
            let stopped = false, timer;
            async function poll() {
              try { const value = await call('status', { gameId }); if (!stopped) setStatus(value); }
              catch (err) { if (!stopped && config?.hostReady) setError(err.message || String(err)); }
              if (!stopped) timer = setTimeout(poll, 1200);
            }
            if (config?.hostReady) poll();
            return () => { stopped = true; clearTimeout(timer); };
          }, [gameId, config?.hostReady]);
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
              await refresh(); setNotice('预设已导入。原 JSON 和脚本作为数据保存，脚本不会直接执行。');
            });
          }
          async function readRequest() {
            let offset = 0, chunks = [], info;
            do {
              const part = await call('request', { gameId, offset });
              if (!part) throw new Error('本次会话还没有已编译请求，请先重生成');
              if (info && info.createdAt !== part.createdAt) throw new Error('请求已更新，请重新打开预览');
              info = part; chunks.push(part.text); offset += part.text.length;
            } while (offset < info.total);
            const text = chunks.join('');
            setReport(info.report); setRequest(text); setRequestShown(true);
          }
          const selected = config?.presets.find(item => item.id === config.activeId);
          const activeReport = report || selected?.report;
          const controls = [
            ['maxTokens', '输出 token 上限', '留空使用预设'],
            ['contextLimit', '上下文预算（可选）', '留空由宿主模型检查'],
            ['temperature', '温度', '留空使用预设'],
          ];
          return h('div', { style: { padding: 16, maxWidth: 900, margin: '0 auto', color: 'inherit', overflowY: 'auto', maxHeight: close ? '94vh' : undefined } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
              h('div', null, h('h2', { style: { margin: '0 0 6px' } }, 'STcontext'), h('p', { style: { margin: '0 0 14px', opacity: .75 } }, '导入预设 · 完整可见历史 · 独立重生成')),
              close && h('button', { style: button, onClick: close }, '关闭')),
            error && h('p', { role: 'alert', style: { color: '#dc6c65', whiteSpace: 'pre-wrap' } }, error),
            notice && h('p', { role: 'status' }, notice),
            config?.hostReady === false && h('p', { role: 'alert' }, '宿主尚未提供重生成接口，请更新 DSH Tavern。预设仍可导入保存。'),
            h('section', { style: box },
              h('strong', null, '预设 JSON'),
              h('input', { ref: file, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: event => { const selectedFile = event.target.files?.[0]; event.target.value = ''; importFile(selectedFile); } }),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' } },
                h('button', { style: button, disabled: busy, onClick: () => file.current?.click() }, '导入 JSON'),
                h('button', { style: button, disabled: !selected || working, onClick: () => act(async () => { const value = await call('export', { id: selected.id }); download(value.name, value.text); }) }, '导出原文件'),
                h('button', { style: button, disabled: !selected || busy, onClick: () => act(async () => { await call('remove', { id: selected.id }); await refresh(); setReport(null); }) }, '移除')),
              h('select', { style: { ...field, marginTop: 10 }, value: config?.activeId || '', disabled: busy, onChange: event => { const id = event.target.value; act(async () => { await call('select', { id }); setReport(null); await refresh(); }); } },
                h('option', { value: '', disabled: true }, '请选择导入的预设'),
                ...(config?.presets || []).map(item => h('option', { key: item.id, value: item.id }, item.name))),
              selected && h('p', { style: { fontSize: 12, opacity: .75, wordBreak: 'break-all' } }, 'SHA-256：' + selected.digest)),
            h('section', { style: box },
              h('strong', null, '生成设置'),
              h('label', { style: { display: 'block', marginTop: 10 } }, '请求模式',
                h('select', { style: field, value: settings.adapter || 'auto', disabled: busy, onChange: event => setSettings({ ...settings, adapter: event.target.value }) },
                  h('option', { value: 'auto' }, '自动识别已适配脚本'), h('option', { value: 'st' }, '标准 ST（明确忽略脚本行为）'))),
              h('label', { style: { display: 'block', marginTop: 10 } }, '模型',
                h('select', { style: field, value: settings.model || 'foreground', disabled: busy, onChange: event => setSettings({ ...settings, model: event.target.value }) },
                  h('option', { value: 'foreground' }, '当前前台模型'), h('option', { value: 'background' }, '本局后台模型'))),
              ...controls.map(([key, label, placeholder]) => h('label', { key, style: { display: 'block', marginTop: 10 } }, label,
                h('input', { type: 'number', step: key === 'temperature' ? '.1' : '1', min: key === 'temperature' ? 0 : 1, style: field, placeholder, value: settings[key] ?? '', disabled: busy, onChange: event => setSettings({ ...settings, [key]: event.target.value }) }))),
              h('button', { style: { ...button, marginTop: 12 }, disabled: busy, onClick: () => act(async () => { await call('settings', settings); await refresh(); setNotice('设置已保存'); }) }, '保存设置')),
            h('section', { style: box },
              h('strong', null, '正文重生成'),
              h('p', null, status ? (labels[phase] || phase) : '尚未开始'),
              status?.result?.warning && h('p', { role: 'status', style: { whiteSpace: 'pre-wrap' } }, status.result.warning),
              status?.result?.settlementStatus === 'failed' && h('p', { role: 'status' }, '新正文已保留，后台结算失败。请在宿主中重试结算。'),
              status?.error && h('p', { role: 'alert', style: { color: '#dc6c65', whiteSpace: 'pre-wrap' } }, typeof status.error === 'string' ? status.error : status.error.message),
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                h('button', { style: button, disabled: busy || !selected || !config?.hostReady, onClick: () => act(async () => { await call('settings', settings); setReport(null); const value = await call('start', { gameId }); setStatus(value); }) }, '重新生成最新正文'),
                h('button', { style: button, disabled: !canCancel || working, onClick: () => act(async () => { const value = await call('cancel', { gameId, id: status.id }); setStatus(value); }) }, '取消生成'),
                h('button', { style: button, disabled: working, onClick: () => act(readRequest) }, '查看本次请求')),
              h('p', { style: { fontSize: 12, opacity: .75 } }, '只发送用户可见的历史。生成结果经过预设输出正则一次处理后，由宿主替换正文并从起点重新结算。')),
            activeReport && h('details', { style: box, open: true }, h('summary', null, '兼容报告'),
              h('p', null, '顺序 ' + activeReport.order + ' · ' + activeReport.enabledPrompts + ' 项提示词 · ' + activeReport.regexCount + ' 条原生正则 · ' + activeReport.protocol),
              ...(activeReport.blockers || []).map((text, index) => h('p', { key: 'b' + index, style: { color: '#dc6c65' } }, text)),
              h('ul', null, ...(activeReport.warnings || []).map((text, index) => h('li', { key: index }, text))),
              activeReport.historyRules?.length > 0 && h('details', null, h('summary', null, '不对历史正文重复执行的规则'), h('ul', null, ...activeReport.historyRules.map(rule => h('li', { key: rule.index }, rule.name))))),
            requestShown && h('section', { style: box },
              h('div', { style: { display: 'flex', gap: 8 } }, h('button', { style: button, onClick: () => download('stcontext-request.json', request) }, '下载完整请求'), h('button', { style: button, onClick: () => setRequestShown(false) }, '收起')),
              h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, maxHeight: 500, overflow: 'auto' } }, request)));
        }
        ui.registerPanel({ id: 'st-context', title: 'STcontext', render: ({ gameId }) => h(Panel, { gameId }) });
        ui.registerComposerAction({
          id: 'regenerate', label: 'STcontext 重生成',
          run: async ({ gameId }) => {
            ui.openOverlay({ gameId, render: ({ close }) => h(Panel, { gameId, close }) });
          },
        });
      },
    };
  },
});
