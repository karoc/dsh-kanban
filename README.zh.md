# dsh-kanban

[English](README.md) | 简体中文

[![license MIT](https://img.shields.io/npm/l/dsh-kanban.svg)](LICENSE)

一个**外部** DeepSeek Harness 插件：跨会话、跨分支、持久化的**计划 / 待办看板**。

在 dsh（以及 Codex / Claude Code 等对话式 agent）里和模型聊多了计划、待办之后，最痛的问题是：**一旦中途去处理别的分支或开新会话，之前的计划和待办就"看不见了"**——它们还躺在长对话里，但你找不到、想不起来。

`dsh-kanban` 把计划和待办**沉淀到工作区根目录的一个 `KANBAN.json` 文件**（可进 git、可手动编辑、跨会话保留），并给你两个入口同时维护它：

- **模型入口**：4 个模型工具（`board_list` / `board_add` / `board_update` / `board_remove`），模型在对话中主动把计划步骤、待办记进看板；
- **Web 入口**：dsh Web GUI 侧边栏新增「看板」按钮，点开是一个**全屏三列看板页**（待办 / 进行中 / 已完成），支持查看、勾选移动状态、新增、删除。

同一个 `KANBAN.json` 由模型工具和 Web 页共享读写，所以**模型写进去的，页面能看到；你在页面勾掉的，模型下次也读得到**。

## 它新增了什么

### 模型主动维护（Host 端核心）

插件在系统提示词里注册了一段**看板使用指引**，让模型在对话中**主动**把计划/待办记进看板、随进度推进状态，而不是等用户要求：

- 用户提出多步骤计划或任务清单时 → 模型逐条 `board_add`（每步一张卡片）；
- 工作推进 → 模型 `board_update` 把对应卡片移到 `in_progress` / `done`；
- 换分支、开新会话 → 模型会先 `board_list` 恢复上下文（跨会话不丢）；
- 与 `todo_write` 的分工：`todo_write` 是**当前回合的临时任务表**，看板是**跨会话的持久记录**——需要用户之后还能看到的东西记看板。

> 实测（真实模型，用户只说"做个 Markdown 转 HTML 工具 + 制定计划"，未提看板）：
> 模型主动 `board_list` → `board_add` 记录 7 步计划 → 每完成一步 `board_update` 推进到 done。

### 工作原理与透明度

**模型"主动用看板"靠什么？** 两层机制，都发生在 dsh 的**系统提示词**里，对用户公开可见：

1. **看板使用指引**（`ctx.systemPrompt.section`）：一段固定指引，告诉模型"看板是什么、何时该记、和 todo_write 的分工"。随插件版本更新。
2. **会话开始自动注入**（`ctx.systemPrompt.context`）：每次装配提示词时，插件按当前会话工作区读 `KANBAN.json`，把**未完成项摘要**（todo + in_progress）**自动注入**到模型上下文——让模型一上来就看到看板，而不必记得去 `board_list`。无会话/无工作区/看板为空时注入为空（不贡献内容）。

**这个"自动注入"的利弊（公开透明）：**

| 维度 | 说明 |
|---|---|
| ✅ 利 | 模型**必然看到**当前工作区的待办，不用"记得去查"；跨会话连续性由系统保证，而不是靠模型自觉 |
| ⚠️ 成本 1 | 每次对话的请求都会带上看板摘要，**增加固定 token 开销**（看板越大开销越大） |
| ⚠️ 成本 2 | 看板内容变化会**改变请求前缀**，可能影响 **KV cache 复用**。为减小影响，**只注入未完成项**（todo + in_progress），不注入 done（done 频繁变化会加剧前缀抖动） |
| ⚠️ 取舍 | 这是"主动给" vs "被动查"的权衡——系统注入保证可见，代价是每次请求的额外负担 |

**模型怎么"用起来"的完整机制：**
1. **看板使用指引**（`ctx.systemPrompt.section`）：告诉模型"看板是什么、何时该记、和 todo_write 的分工"，以及**卡片完整度契约**——每张卡必须有 rationale（为什么，创建时写）；done 卡必须三字段（做了什么/为什么/放弃了什么）齐备。
2. **会话开始自动注入**（`ctx.systemPrompt.context`）：未完成项摘要自动进模型上下文（见上）；缺字段的卡会带 `(缺:…)` 标注，接手的会话看到就能补。
3. **收尾纪律**：指引明确要求——**每轮工作结束**，模型必须把完成项移到 done、把新后续加为 todo、更新 summaries，**不留 stale 的 in_progress**，让看板成为诚实的跨会话交接。
4. **用户侧可见性**：侧边栏「看板」入口显示**未完成计数角标**（`/kanban/counts` 端点，工作区最近活跃优先，订阅工作区变更即时刷新）；看板页打开时**每 15s 自动刷新**，模型/其他会话写入后自动更新。

**数据安全承诺**：插件**只写不删**看板/笔记文件；没有启动清理、定时清理、安装清理。卡片只能被显式 `board_remove` / Web 删除按钮移除（删除需二次确认）；超量 done 卡片是**归档**（移到 `.agents/notes/archive.json`），永不删除。所有数据在你**工作区目录**内（可进 git、可手改）。

### 模型工具

| 工具 | 作用 |
|---|---|
| `board_list` | 读取当前工作区的看板（全部卡片 + 状态 + 标签 + 时间戳）。任何更新前先读它拿真实 id。 |
| `board_add` | 新增一张卡片（title + **rationale/为什么 每张卡都应写**——只有标题是不完整卡，会被标注 ⚠️缺；有取舍决策时写 rejected/放弃了什么；summary/做了什么 完成时写；可带 description、status、tags）。 |
| `board_update` | 更新卡片（按 id，可改 status / title / summary / rationale / rejected / description / tags）。 |
| `board_remove` | 删除卡片（按 id）。 |
| `note_add` | 写一份 Agent Note（完整复刻 DSH 仓库纪律），存到 `.agents/notes/implemented/<class>/<date>-<topic>.md`。 |
| `note_list` | 列出当前工作区已有的 Agent Notes。 |

工具以**当前会话的工作目录（cwd）**为看板归属：同一个项目目录下所有会话共享同一份 `KANBAN.json`，这就是"跨会话、跨分支不丢"的关键。

### Agent Note 规范（可编辑，避免重复造轮子 + 可同步）

`note_add` 产出的格式、分类、"非平凡变更"定义**复刻自 deepseek-harness 仓库**（不重复发明轮子）：

| 项 | 上游来源 |
|---|---|
| 笔记分类 | `scripts/agent-note-tree.ts` → `AGENT_NOTE_CLASSES` |
| 笔记格式 | `scripts/verify-agent-note-format.ts` |
| 非平凡变更定义 | 根 `AGENTS.md`（"Non-trivial changes MUST include an Agent Note…"） |

- **插件自带默认**（随版本更新）：`src/note-spec.ts` 固化默认分类、格式模板、非平凡定义，发布后开箱即用；
- **用户可覆盖**：Web 看板页的「Agent Note spec」区提供**三个输入框**，可粘贴 dsh 上游最新内容替换默认；覆盖存工作区 `.agents/notes/overrides.json`；
- **来源指引**：每个输入框下方明确标注对应 dsh 源码文件，用户知道去哪复制最新内容；
- **更新警告**：插件升级后若工作区有自定义覆盖且规范版本落后，页面明确提示"更新插件会把覆盖重置为插件默认，你自定义的内容会丢失"。用户可「保存覆盖」更新 acknowledgeSpecVersion，或「恢复默认」清空覆盖。

> 为何不能直接 import dsh：`verify-agent-note-format.ts` 是 dsh 仓库内脚本，不发布、不可安装、外部插件无法引用；规范只能以常量形式固化，靠"输入框覆盖 + 版本升级"同步。

#### 同步机制（开发期检查 + 发版）

- **来源锚定**：`src/note-spec.ts` 顶部注明复刻自 deepseek-harness（上游 commit `47f943859bef60e4160492346772ded9b24f765a`）；
- **开发期检查**：`pnpm check:spec`（`scripts/check-note-spec.mjs`）读取本机 dsh 源码的规范常量（`agent-note-tree.ts` 的分类、`verify-agent-note-format.ts` 的格式、`AGENTS.md` 的非平凡规则），与插件默认逐项对比——上游一改，跑一次就报差异，提示更新 `src/note-spec.ts` 并 bump `NOTE_SPEC_VERSION`；
- **发版同步**：作者更新默认常量后发布新版本；用户 `dsh plugin update dsh-kanban` 拿到新默认（若用户自行覆盖过，页面会按"更新警告"提示覆盖会被重置）。

`check:spec` 依赖本机 dsh 源码路径，是**开发期工具**（不随发布分发、不进用户 `test`）。

### `/kanban` 命令

`/kanban` 查看当前工作区看板；`/kanban done <card-id>` 快速把一张卡片标记为完成。

### Web 看板页（Client 端）

![Web 看板页：全屏三列看板（待办 / 进行中 / 已完成）](docs/screenshots/board-page.png)

- 侧边栏底部「看板」入口（`sidebar.footer.action`），**显示未完成计数角标**（有 todo/in_progress 卡片时显示数字，>99 显示 "99+"）；
- 点开是全屏三列看板：**待办 / 进行中 / 已完成**，每列带卡片计数；
- **工作区选择器**：顶部可切换任意工作区（每个工作区有独立 KANBAN.json），默认跟随当前会话工作区；
- 每张卡片可：下拉改状态（含勾选完成）、**删除（需二次确认 Modal，防误删）**；卡片显示模型填写的"做了什么/为什么/放弃了什么"三字段，模型创建的卡片带"打开来源会话"按钮（跳到处理会话）；
- **两行截断预览**：卡片上三个"什么"字段每个最多显示两行，超出部分以 `...` 省略，卡片高度可控、扫读高效；
- **详情弹窗**：点击卡片的标题 + 三个"什么"区域（含描述）打开详情 Modal，完整内容按区块排版（图标 + 标签 + 保留换行的全文），并附状态、标签、来源会话与创建/更新时间，阅读友好；
- 底部新增表单：标题 + 三个"什么"输入框（一行三列）；
- **静默自动刷新**：打开期间每 15s 静默刷新一次——按内容签名做 diff，内容未变时**完全不触碰卡片 DOM**，因此**不会打断阅读、不会丢失滚动位置**；标题下会显示"自动更新于 HH:mm:ss"表明刷新在运行；失败时保留当前视图、不闪错误。
- 页面通过 Host 端 `webServer` 注册的 `/kanban/api`、`/kanban/counts` 路由读写数据（GET 读、POST 增删改），不依赖 dsh 内置 RPC，官方升级不影响。

### 数据文件

```
<工作区根>/KANBAN.json
```

```json
{
  "version": 1,
  "cards": [
    {
      "id": "card-xxxx",
      "title": "实现看板工具",
      "description": "…",
      "status": "todo",
      "tags": ["dsh"],
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    }
  ]
}
```

文件结构有校验：缺文件视为空看板；结构损坏会明确报错而不是静默修复（防止手改坏数据被悄悄丢掉）。

## 安装

**前置要求：** 已安装带 `dsh` CLI 的 DeepSeek Harness，以及 [pnpm](https://pnpm.io)。这是一个可安装的 **bundle**——由 `dsh` 加载，不是当作库 import。

### 从本地开发目录安装（开发/自用）

```sh
dsh plugin --profile web add /home/karoc/dsh-kanban
```

（从目录包含本包的地方运行；`dsh plugin` 会 link 本包并把它追加到 `web` profile 的 `dsh.profile.bundles`。）

### 从 npm 安装（发布后）

```sh
dsh plugin --profile web add dsh-kanban
```

### 从 git 安装

```sh
dsh plugin --profile web add github:karoc/dsh-kanban#<sha>
```

git 安装会运行包的 `prepare` 脚本构建 bundle；pnpm ≥ 10 需要在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 里放行一次构建（把 pnpm 打印的包 key 填进去后重新 `add`）。

**安装后必须重启 `dsh web`** 才能加载 Host 工具与 Web 页面。

### 更新 / 卸载

```sh
dsh plugin --profile web update dsh-kanban
dsh plugin --profile web remove dsh-kanban   # 同时移除依赖和 bundle 层，重启后入口消失
```

## 使用

1. 安装并重启 `dsh web` 后，侧边栏底部出现「看板」按钮；
2. 和模型对话时让它用 `board_add` 记录计划步骤（例如"把 xxx 记进看板"），模型会写入当前工作区的 `KANBAN.json`；
3. 随时点侧边栏「看板」查看三列视图；勾选完成 / 改状态 / 新增 / 删除都可以在页面上直接做；
4. 换分支、开新会话后，看板数据依然在——它就是工作区里的一个文件。

## 卡片完整度与 kanban-use 技能

卡片是看板跨会话记忆的载体：下一个会话**不问你**，只看卡片。因此插件在模型能看到的每个表面都强制执行同一份完整度契约（规则统一在 `board-core.ts` 的 `missingCardFields`）：

- **每张卡必须有 `rationale`（为什么）**——为什么存在、为什么现在做。只有标题的卡是不完整卡，会在三处被标注：
  - **工具输出**（卡片行后 `⚠️缺:…`，有缺字段时还有汇总提示行）；
  - **会话开始注入**（开放项带 `(缺:…)`，恢复会话时模型可见、可补）；
  - **Web 看板页**（卡片字段下方黄色警告行「缺字段：…」，用户侧同样可见）。
- **`done` 卡片必须自解释**：`summary`（做了什么）+ `rationale`（为什么）+ `rejected`（放弃了什么）三字段齐备，完成的活才是诚实的交接。

**kanban-use 技能**（`skills/kanban-use/SKILL.md`）是这套纪律的深度手册——字段语义、好/坏卡片对比、创建 → 推进 → 收尾全流程、关闭检查清单与模板。系统提示引导会把模型指向它。**安装与升级都是自动的**：技能随 npm 包分发（tarball 内含 `skills/kanban-use/SKILL.md` 与 `scripts/install-skill.mjs`），插件 host 半区每次 `dsh web` 启动时检查 `~/.agents/skills/kanban-use/SKILL.md`。技能 frontmatter 里的 `skill-version` 指纹（内容变更时递增）驱动同步策略：缺失 → 复制包内版本；一致 → 不动；**同版本但内容不同 → 保留你的本地版本**（这是你对当前版本的编辑）并提示；**旧/异版本 → 覆盖同步**（这是上一次安装留下的旧包内容，即升级路径）。所以「`dsh plugin add/update dsh-kanban` + 必需的重启」就够了，任何机器都生效。手动命令仍保留（仓库开发 / 强制同步）：

```sh
pnpm install:skill            # symlink skills/kanban-use → ~/.agents/skills/kanban-use
node scripts/install-skill.mjs --copy   # 实体复制/覆盖（装在包内时同样可跑）
```

技能**与本插件同一仓库维护**：开发/发布门禁（`pnpm check:cards` → `scripts/check-card-discipline.mjs`）保证技能里教的字段语义与工具名和插件 schema 一致；`scripts/audit-cards.mjs <workspace> [--fail]` 可审计任意工作区 `KANBAN.json` 的卡片完整度。

## 目录结构

```
cordis.patch.yml      # bundle 层：挂载本包（Host 工具 + client 半区）
package.json          # dsh.bundle（patch）+ dsh.client（web）+ exports["./client"]
tsdown.config.ts      # 自包含构建：node 半区 + 模块表客户端 bundle
src/board-core.ts     # KANBAN.json 领域：读写、校验、卡片 CRUD、
                      #   missingCardFields 完整度规则（全表面共享）
src/index.ts          # Host 半区：4 个模型工具 + /kanban/api webServer 路由
src/client/index.ts   # client apply：注册侧边栏入口 + 全屏看板页
src/client/BoardPage.tsx   # 三列看板页组件（含缺字段提示行）
src/client/KanbanSurface.tsx # 侧边栏按钮 + overlay 包装
src/client/board-state.ts   # 页面开关的模块级 observable
src/client/locales.ts       # 中英文案
src/client/styles.ts        # --dsw-alias-* 设计令牌样式
src/skill-sync.ts           # Host 半区：kanban-use 技能自愈安装（每次 dsh web 启动检查）
skills/kanban-use/SKILL.md  # kanban-use 技能（随 npm 包分发，启动时自动安装）
scripts/check-card-discipline.mjs # 开发门禁：引导/schema/技能对完整度口径一致
scripts/audit-cards.mjs          # KANBAN.json 完整度审计（[workspace] [--fail]）
scripts/install-skill.mjs        # 把技能 symlink/复制进 ~/.agents/skills（随包分发）
scripts/verify-skill-sync.mjs    # 技能自愈三态验证（并入 pnpm test）
docs/screenshots/board-page.png  # Web 看板页截图（README 配图）
```

## 为什么做成外部插件

dsh 官方更新的覆盖范围是仓库内的内置包；**外部 bundle 由 `dsh plugin` 装进用户 profile，官方升级不会触碰它**（与 `dsh-model-reasoning` 同一模式）。插件只用 dsh 对外稳定的能力面：模型工具注册（`ctx.tools`）、webServer 路由注册、以及 Web 侧边栏 / overlay 槽位——官方更新无法覆盖它。

## 已知限制（第一版）

- **只服务 dsh**：Codex / Claude Code 的待办汇聚留待后续（`KANBAN.json` 本身是普通文件，未来任何工具都能读）。
- **不做自动提取**：靠模型主动写入 + 页面手动维护，数据干净可控。
- **一个工作区一张看板**：单层卡片列表，计划用 tag 或卡片分组表达（不做多看板/嵌套列）。
- **JSON 优先**：机器可读写、diff 友好；`KANBAN.md` 渲染视图可后续加。

## 开发

```sh
pnpm install   # 构建依赖（tsdown, react）
pnpm bundle    # 产出 lib/index.js + lib/client.js
```

- `src/client/` 是浏览器插件；client bundle 保持 `@deepseek-ai/*` + `react` external（运行时从 loader 模块表解析），其余内联。
- UI 使用 `--dsw-alias-*` 设计令牌，命名空间 `kb-` 前缀避免冲突。

## 验证

```sh
pnpm test       # tsc --noEmit 类型检查 + 14 个 KANBAN.json 领域单测 + Host 工具冒烟
pnpm typecheck  # 仅类型检查（tsc --noEmit）
pnpm verify     # 4 个 board 工具注册 + board_add 端到端落盘
pnpm accept     # 对运行中的 dsh web (http://127.0.0.1:3080) 做 GUI 验收：
                #   侧边栏入口（原生 DSH 按钮）→ 全屏三列页（不透明背景）→ 新增/移动/删除
```

外部插件默认不做编译期类型检查（tsdown 只转译）；`tsc --noEmit` 在 `pnpm test`
里兜底，避免"用未导入的组件/图标导致运行时崩溃"这类问题（曾因漏导入
`IconCheckOutline16` 使看板页整体崩溃）。

`scripts/verify-model-board.mjs` 额外验证**真实模型调用**：向 GUI 会话发一条让模型用
`board_add`/`board_list` 的指令，确认卡片写入会话 cwd 的 `KANBAN.json`、并能在看板页读到
（模型侧写入 ↔ Web 侧可见的双向闭环）。

## 许可

[MIT](LICENSE)
