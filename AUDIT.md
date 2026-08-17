# dsh-kanban 插件审计报告

审计日期：2026-08-17
审计依据：`dsh-plugin-development` 技能（SKILL.md）逐节对照
插件版本：0.1.0（已发布 npm）

## 结论

**插件符合 DSH 外部插件规范，无功能性问题。** 所有测试通过，发布包在 npm 上可用。
发现若干"与技能描述不完全对应"的点，但这些是**插件正确行为**，不是缺陷；
同时发现技能本身有多处**本次开发沉淀的新经验**值得回写。

## 逐节审计

### §1 为什么做外部插件
✅ 插件完全不碰 dsh 源码，通过 `dsh plugin add` 安装，官方更新不覆盖。

### §2 项目骨架
✅ package.json（type:module / exports / files / dsh.bundle / dsh.client / scripts）符合规范。
✅ cordis.patch.yml、tsdown.config.ts、双语 README、CHANGELOG、CONTRIBUTING、LICENSE 齐全。
⚠️ 技能说 `src/index.ts` 是"空操作"——**本插件的 node 半区非空**（注册模型工具 + webServer 路由 + systemPrompt + commands）。这是技能未覆盖的重要能力面。

### §3 客户端插件架构
✅ slot 注册模式正确（`ctx.slots.inject` + `ctx.slots.register`）。
✅ i18n 双语文案（en 为 key 源，zh 同键）。
✅ type-only import 引 slot 声明（ui-layout/ui-sidebar/locale）。
✅ 模块顶层副作用导入样式（符合 §5 摇树陷阱）。
⚠️ 技能只讲 `settingsScope` 通道；**本插件用自建 webServer 路由 + 同源 fetch 做数据通道**（不依赖 dsh RPC、官方升级不影响）——技能未覆盖。
⚠️ 本插件用 `shell.overlay`（root 级全屏覆盖层）+ `useSessions`/`useWorkspaces` 全局标准套件——技能只讲 `settings.section`。

### §4 UI 对齐
✅ 全用 `@deepseek-ai/dsh-client-ui-primitives`（Button/Menu/Pill/Input/图标）。
✅ 无原生 select（用选择胶囊 + Menu 模式）。
✅ 颜色全用 `--dsw-alias-*` token，无写死色值。
✅ 空状态虚线框 + 居中 + tertiary。
✅ Menu portal（滚动容器内下拉不被裁剪）——新经验，技能未覆盖。

### §5 构建
✅ client.js 用 `window.__ModuleLoader__.load({ id, factory })` 契约。
✅ external 正确（react / react/jsx-runtime / primitives 保留 require）。
✅ 样式注入在模块顶层副作用（非闭包）——符合技能 §5。
✅ node 半区保持 `@deepseek-ai/dsh-tools` external（运行时从 profile node_modules 解析）。

### §6 发布流程
✅ release-check 覆盖技能要求的 6 项（双语段数、CHANGELOG、版本/tag、干净树、lib 新鲜、未发布）。
✅ post-publish 有轮询（3s × 14 = 42s 等 registry 索引）——**本次修复了复制时丢失的轮询**。
⚠️ 技能未提 **npm 发布需人工 2FA**（agent 无法代发，只能人工 npm login + npm publish）。已写入本项目 CONTRIBUTING。
⚠️ release-check 的"版本已发布"和"tag 不指向 HEAD"是**发布后预期状态**（保护已发布版本），不是缺陷。

### §7 安装
✅ `dsh plugin --profile web add dsh-kanban@0.1.0` 从 npm 安装成功。
⚠️ 审计时执行了 npm add，把 profile 的 dsh-kanban 从 link 本地版改成了 npm 版——需用户确认是否恢复 link 开发版。

### §8 常见坑
- 数组写路径坑（settings.mutate）：**本插件不使用 settings.mutate**（用自建路由），不涉及。
- 摇树陷阱：已规避（模块顶层样式注入）。
- postpublish 立即查 registry：已修复（轮询）。
- 原生 select：已规避（Menu）。
- 新坑记录：Menu portal 防裁剪、node 半区非空、模型工具注册、systemPrompt 引导、/command 注册、全局标准套件、模块级 observable 跨组件共享。

## 技能需回写的内容（见 SKILL.md 更新）

1. **node 半区能力面**：外部插件 host 半区可注册模型工具（ctx.tools.register + defineTool）、webServer 路由、systemPrompt.section、/command——不止空 apply。
2. **自建数据通道**：webServer 路由 + 浏览器同源 fetch，作为 settingsScope 之外的另一种数据通道（官方升级不影响）。
3. **root 级 UI 表面**：shell.overlay（全屏覆盖层）+ useSessions/useWorkspaces 全局标准套件 + 模块级 observable（useSyncExternalStore）跨组件共享。
4. **Menu portal**：滚动容器内下拉不裁剪。
5. **工作区级数据文件**：用户工作产物（KANBAN.json 类）放工作区（可 git），vs settingsScope 存 dsh 配置——两种数据哲学。
6. **人工 2FA 发布**：npm 发布需人工，agent 只能准备到"一条命令可发"。
7. **数据安全**：插件只写不删（无自动清理），用户数据可 git 追踪。
