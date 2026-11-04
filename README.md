# dsh-tavern-STcontext

在 DSH Tavern 中导入 SillyTavern 预设，使用宿主冻结的完整可见历史生成新正文或重生成最新正文。正文返回前执行一遍导入预设的输出正则，再由宿主校验、保存、同步主会话并结算。

## 安装与使用

从 0.4.0 起面向 [flizzywine/dsh-tavern 上游](https://github.com/flizzywine/dsh-tavern)，需要包含正文生成扩展点的版本（首次实现于 `09620ebe`）。上游插件 API 为 7，插件检查 `capabilities.bodyGeneration === 1` 并统一注册 `bodyGenerator({ prepare, generate })`；不使用旧 fork 的 API 8 或独立重生成任务接口。仅修改宿主工作区代码不会更新已安装的 Profile，须先更新实际使用的宿主并重启。

在 STcontext 面板导入预设、选择正文模型并保存后，打开「设置 → DSH Tavern → 剧情」，先选择正文生成插件 STcontext，再选择：

- **插件直接生成**：宿主准备材料后直接调用插件，不额外请求前台模型。
- **前台检索后由插件生成**：前台模型先查询世界书，再由插件生成正文，会产生额外的前台模型请求。

本局设置可以覆盖全局选择。正常发送、最新正文重生成和失败输入重试均使用宿主原有按钮，停止也由宿主控制。插件面板不再提供独立的开始、取消和任务状态轮询，保留预设设置、模型选择和请求预览。

插件正文一次性显示。插件不可用、生成失败或完整上下文超限时明确报错，不回退到宿主生成。正文提交后的结算仍由宿主完成。宿主在操作开始时通过 `prepare` 冻结预设、模型及采样配置，正常轮次在前台检索之前冻结；生成期间切换或移除预设、修改模型只影响后续操作。已有预设及独立模型设置无需转换，保留插件数据即可。

旧存档缺少可靠材料快照时由宿主明确拒绝生成，建议先用更新后的新会话验证。配置快照按宿主要求最多 2 MiB，两种回调均受宿主 10 分钟超时及取消信号约束。

当前自动生成接口只支持文本输入；本轮带附件时会明确报错，不会忽略附件继续生成。

模型请求由插件直接使用 DSH 的 `llm` 服务发送；需要 DSH 0.2.1 的 `prepareCall`、`listProviders`、`listModels` 接口，可选复用 `tokenMeter`。在 STcontext 面板独立选择服务商下的文本模型及其支持的推理强度，模型服务和凭据沿用 DSH 已配置的服务商。插件保存自己的选择，正文生成和重生成均使用该模型，不随前台或后台模型切换。插件负责预算检查、取消和响应校验，宿主负责正文生命周期和结算。

从 0.2.x 升级后，原有的前台/后台跟随设置需要在面板重新选择并保存。没有选择模型时不会发送正文请求；已选模型不可用时直接报错，不自动切换。模型列表可单独刷新；个别服务商读取失败不会影响其他服务商的模型选择。

插件没有额外第三方依赖，不需要 `npm install` 或构建，也不需要安装 SillyTavern。

本地目录安装：在 PowerShell 中进入本插件目录，执行以下命令，将运行文件复制到 Tavern 用户插件目录。设置过 `DSH_HOME` 时应使用实际启动 Tavern 的同一个值；以下命令以 Desktop 默认目录 `%USERPROFILE%\.dsh` 为例；CLI 默认使用 `%USERPROFILE%\.dsh-tavern`，使用 CLI 时应将根目录改成该路径。

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

在 DeepSeek Harness「设置 → STcontext」可直接导入预设、选择模型并保存，无需先打开游戏。需要调整生成设置或查看本次请求时，在游戏中通过侧栏「＋ → STcontext」或输入框上方的「STcontext」打开面板：

1. 导入预设 JSON，查看兼容报告；预设不会编译进源码。
2. 选择预设和「插件正文模型」，按需设置「推理等级」，点击「保存设置」；请求模式位于「预设适配」中。等级按所选模型的详细能力加载；没有可选等级时显示「模型默认」并禁用选择，不发送额外的推理等级参数。切换模型会清除旧模型的等级设置，读取失败时可通过「刷新模型列表」重试。
3. 保存设置并在宿主剧情设置中选定 STcontext 后，使用宿主的发送、重生成、失败重试和停止按钮。正文提交后继续完成主会话同步和结算，此时停止不会撤销正文。
4. 可查看或下载本次实际请求。新正文提交后结算失败时，通过宿主重试结算；不会撤掉已提交正文。

面板按预设、正文模型和使用说明分区，窄屏自动纵向排列。侧栏和弹窗在可用高度内上下滚动，设置页沿用宿主的滚动区域。兼容报告默认收起，阻止生成的问题会自动展开显示。输出 token 上限、上下文预算和温度不再提供界面控件；已有参数配置继续保留，未配置的参数仍沿用预设或模型默认值。

预设以压缩形式保存在当前宿主的插件数据中，更新插件不会覆盖。支持导出原文件、切换和移除。文件最多 2 MB，全部预设压缩后的存储合计受宿主 256 KB 上限约束。导入中的分块不持久化。

## 兼容范围

- ST 聊天补全的 100001 顺序、启用项、角色、材料 marker 和深度提示词。上游 `reason=normal` 使用 `normal`，`regenerate/retry` 使用 `regenerate`；非空 `injection_trigger` 必须包含当前类型才生效。
- 局部 setvar/getvar、基本变量操作、user/char、注释、random/roll；未知宏明确报错。
- 原生 `extensions.regex_scripts`；SPreset RegexBinding 只保留原数据，不重复执行。
- 识别昆仑 IDE 1.2r 已适配的请求改写脚本，将其模板作为数据解析。没有全局 fetch 钩子，也不执行导入的 JavaScript。修改脚本版本后须重新适配；标准 ST 模式可以明确忽略脚本行为。
- 工具描述承载上下文、buffer_content 结果解析由私有适配器完成。模板和正文规范来自用户导入的 JSON，仓库不附带预设。

宿主只导出可见历史。历史正文不重复运行输出正则；输入只应用保留原文的包装规则，所以原预设的删楼、摘要规则不会删掉历史。世界书沿用原轮激活结果，不重新扫描。人物与玩家设定使用宿主已解析的 `context` 段，身份宏使用 `identities`，变量和状态栏使用输入预处理后、正文生成前的 `state`。世界书段已包含本轮有效查询结果，不重复追加；历史和人物材料不再次运行宏或 EJS。旧人物快照可能合并多个字段，不保证还原 ST 原卡的逐项占位结构。

输出处理采用一次有序正则管道：只选择已启用、placement=2、depth=0 适用的规则，合并提示词/显示范围，每条规则最多执行一次。包含 HTML 的结果原样交宿主，不再另行提取 content 标签。正则在有超时的 Worker 中执行，失败不会替换正文。

采样支持 temperature、输出 token 上限、独立模型选择及模型提供的推理强度。尚未映射的采样参数列在兼容报告中。超限、未支持的脚本/宏/模型协议均报错，不自动截断、降级或切换模型。预设中的上下文容量不是模型能力保证。

请求预览只在内存中保留最近三局，重启后清除；不持久化完整故事。导出请求会包含完整可见材料，请按自己的需要保存。

## 验证

运行 `npm test`。可选设置 `STCONTEXT_PRESET_FIXTURE` 为本地预设路径后运行测试，会验证该文件的请求编译与一次输出正则；测试不会发送模型请求，也不会把该文件复制进仓库。

设置 `STCONTEXT_HOST_REPO` 后，`tests/client-browser.test.mjs` 使用宿主的 Playwright 与 React 开发依赖检查侧栏、弹窗和设置页在窄屏、低高度窗口中的滚动和保存。可通过 `STCONTEXT_BROWSER_EXECUTABLE` 指定本机 Chromium 或 Edge 路径。

跨仓库联调额外设置 `STCONTEXT_HOST_REPO` 为新版上游 Tavern 工作区路径，并用该宿主的 `bin/test-tavern.mjs` 运行本插件的 `tests/host-smoke.test.mjs`。测试覆盖实际宿主材料导出、统一生成器、正文替换及失败输入补全、原生会话同步和起点结算，模型回包使用测试桩，存档只在内存中。默认使用最小测试预设；可额外设置 `STCONTEXT_PRESET_FIXTURE` 验证已有的昆仑适配预设。插件的 `generation.test.mjs` 在设置 `DSH_BOOT_MODULE` 时还会验证真实 DSH LLM 服务。需要可用的 DSH Session 测试运行时；可显式指定 `DSH_BOOT_MODULE`。

设置 `STCONTEXT_HOST_REPO` 后，`tests/host-generation.test.mjs` 还会验证新正文从宿主准备、STcontext 编译、工具返回到保存和一次结算的完整链路；此测试使用最小测试预设，不需要用户预设文件，并覆盖直接生成、前台检索后生成、冻结配置及回执复用。

同时设置 `DSH_BOOT_MODULE` 和 `STCONTEXT_HOST_REPO` 后，`tests/host-loading.test.mjs` 会通过真实 Cordis 和 Tavern 保护入口验证插件加载、预设导入、卸载与重新加载，并覆盖有、无可选 `tokenMeter` 服务的环境。

尚未宣称兼容全部 SillyTavern 扩展或所有版本的宏引擎。预设组织改变是否降低模型拒绝率，需要结合所选模型实际验证。
