# dsh-tavern-STcontext

在 DSH Tavern 中导入 SillyTavern 预设，使用宿主冻结的完整可见历史生成新正文或重生成最新正文。正文返回前执行一遍导入预设的输出正则，再由宿主校验、保存、同步主会话并结算。

## 安装与使用

需要新版 DSH Tavern 的插件 API 7（`bodyRegeneration: 1`）：提供 `bodyRegenerator`、`startBodyRegeneration`、`bodyRegenerationStatus`、`cancelBodyRegeneration` 接口。仅修改宿主工作区代码不会更新已安装的 Profile；开发阶段须先将相应宿主版本部署到所用 Profile 并重启。旧宿主可以保存预设，但不能启动重生成。

自动生成新正文需要插件 API 8（`bodyGeneration: 1`）的 `bodyGenerator` 接口。在插件面板导入预设并保存设置后，打开「设置 → DSH Tavern → 剧情」，先选择正文生成插件 STcontext，再选择「通过 Tool Call 调用插件」。之后正常发送消息即可：前台模型调用宿主的 `tavern_generate_body`，插件独立生成正文，宿主直接采用并结算，不再让前台模型转述。通常需要一次前台调度请求和一次插件正文请求。宿主的正文重生成、失败轮重试也使用选定插件。

插件模式的正文一次性显示；宿主停止按钮会取消生成。插件不可用、生成失败或完整上下文超限时明确报错，不回退到宿主生成。正文提交后的结算仍由宿主完成。材料和所选生成器按轮冻结，生成中切换宿主设置只影响下一轮。

当前自动生成接口只支持文本输入；本轮带附件时会明确报错，不会忽略附件继续生成。

模型请求由插件直接使用 DSH 的 `llm` 服务发送；需要 DSH 0.2.1 的 `prepareCall`、`agent.model.current()` 接口，可选复用 `tokenMeter`。前台模型读取当前 Agent 的选择，后台模型通过 Tavern 已有的 `backgroundModel` 读取。插件负责预算检查、取消和响应校验，宿主只负责重生成生命周期。

插件没有额外第三方依赖，不需要 `npm install` 或构建，也不需要安装 SillyTavern。

本地目录安装：在 PowerShell 中进入本插件目录，执行以下命令，将运行文件复制到 Tavern 用户插件目录。设置过 `DSH_HOME` 时应使用实际启动 Tavern 的同一个值；默认数据目录为 `%USERPROFILE%\.dsh\profile-data\tavern\data`。

```powershell
$stcontextDshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$stcontextTarget = Join-Path $stcontextDshRoot 'profile-data\tavern\data\plugins\dsh-tavern-STcontext'
New-Item -ItemType Directory -Force -Path $stcontextTarget | Out-Null
Copy-Item -LiteralPath '.\package.json', '.\index.mjs', '.\client.js' -Destination $stcontextTarget -Force
Copy-Item -LiteralPath '.\lib' -Destination $stcontextTarget -Recurse -Force
```

复制后重启 Tavern，在「设置 → DSH Tavern → 插件」检查 `dsh-tavern-STcontext` 已加载；曾停用过此插件时在这里启用。开发更新同样复制上述运行文件并重启。不要将工作目录直接改成已安装宿主的程序目录。

如果 0.2.0 在导入时提示“没有名为 dsh-tavern-stcontext/upload/begin 的插件处理函数”，请升级到 0.2.1 或更新版本并重启 Tavern。0.2.0 的宿主端依赖声明不兼容 DSH 0.2.1 的 Cordis 加载器，会导致面板已显示但宿主端未启动；刷新页面不足以重新加载宿主端。

也可将 `package.json`、`index.mjs`、`client.js`、`lib/` 放在 ZIP 根目录，通过上述插件管理页面上传安装。

在侧栏「＋ → STcontext」或输入框上方的「STcontext 重生成」打开面板：

1. 导入预设 JSON，查看兼容报告；预设不会编译进源码。
2. 选择预设及模型，按需设置输出 token 上限。空值沿用预设或宿主设置。
3. 点击「重新生成最新正文」。生成阶段可取消；正文提交后继续完成主会话同步和结算，此时不再取消。
4. 可查看或下载本次实际请求。新正文提交后结算失败时，通过宿主重试结算；不会撤掉已提交正文。

预设以压缩形式保存在当前宿主的插件数据中，更新插件不会覆盖。支持导出原文件、切换和移除。文件最多 2 MB，全部预设压缩后的存储合计受宿主 256 KB 上限约束。导入中的分块不持久化。

## 兼容范围

- ST 聊天补全的 100001 顺序、启用项、角色、材料 marker 和深度提示词。新正文使用 `normal`，重生成使用 `regenerate`；非空 `injection_trigger` 必须包含当前类型才生效。
- 局部 setvar/getvar、基本变量操作、user/char、注释、random/roll；未知宏明确报错。
- 原生 `extensions.regex_scripts`；SPreset RegexBinding 只保留原数据，不重复执行。
- 识别昆仑 IDE 1.2r 已适配的请求改写脚本，将其模板作为数据解析。没有全局 fetch 钩子，也不执行导入的 JavaScript。修改脚本版本后须重新适配；标准 ST 模式可以明确忽略脚本行为。
- 工具描述承载上下文、buffer_content 结果解析由私有适配器完成。模板和正文规范来自用户导入的 JSON，仓库不附带预设。

宿主只导出可见历史。历史正文不重复运行输出正则；输入只应用保留原文的包装规则，所以原预设的删楼、摘要规则不会删掉历史。世界书沿用原轮激活结果，不重新扫描。人物优先使用宿主已解析的快照，避免再次运行副作用宏或 EJS。

输出处理采用一次有序正则管道：只选择已启用、placement=2、depth=0 适用的规则，合并提示词/显示范围，每条规则最多执行一次。包含 HTML 的结果原样交宿主，不再另行提取 content 标签。正则在有超时的 Worker 中执行，失败不会替换正文。

采样支持 temperature、输出 token 上限及前台/后台模型选择。尚未映射的采样参数列在兼容报告中。超限、未支持的脚本/宏/模型协议均报错，不自动截断、降级或切换模型。预设中的上下文容量不是模型能力保证。

请求预览只在内存中保留最近三局，重启后清除；不持久化完整故事。导出请求会包含完整可见材料，请按自己的需要保存。

## 验证

运行 `npm test`。可选设置 `STCONTEXT_PRESET_FIXTURE` 为本地预设路径后运行测试，会验证该文件的请求编译与一次输出正则；测试不会发送模型请求，也不会把该文件复制进仓库。

跨仓库联调额外设置 `STCONTEXT_HOST_REPO` 为新版 Tavern 工作区路径，并用该宿主的 `bin/test-tavern.mjs` 运行本插件的 `tests/host-smoke.test.mjs`。测试通过实际宿主材料导出、任务服务、插件直接调用 DSH 和正文替换流程，模型回包使用测试桩，存档只在内存中。插件的 `generation.test.mjs` 在设置 `DSH_BOOT_MODULE` 时还会验证真实 DSH LLM 服务。需要可用的 DSH Session 测试运行时；可显式指定 `DSH_BOOT_MODULE`。

设置 `STCONTEXT_HOST_REPO` 后，`tests/host-generation.test.mjs` 还会验证新正文从宿主准备、STcontext 编译、工具返回到保存和一次结算的完整链路；此测试使用最小测试预设，不需要用户预设文件。

同时设置 `DSH_BOOT_MODULE` 和 `STCONTEXT_HOST_REPO` 后，`tests/host-loading.test.mjs` 会通过真实 Cordis 和 Tavern 保护入口验证插件加载、预设导入、卸载与重新加载，并覆盖有、无可选 `tokenMeter` 服务的环境。

尚未宣称兼容全部 SillyTavern 扩展或所有版本的宏引擎。预设组织改变是否降低模型拒绝率，需要结合所选模型实际验证。
