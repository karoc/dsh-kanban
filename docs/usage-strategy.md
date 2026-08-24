# 怎么让看板真正被用起来

> 背景：插件 v0.1.0 已发布、通过审计。但一个尖锐的事实——连开发它的 agent 自己
> 都一直用 todo_write 而没用看板。功能不缺，缺的是"用起来的理由和习惯"。

## 诊断：为什么用不起来

1. **心智成本**：模型在对话执行流里，主动 `board_add` 需要"想起来"这一步。
2. **无强制关卡**：`todo_write` 有 agent loop 塞进上下文；看板没有"该记一笔"的强制时刻。
3. **信息单向**：看板是存储，但新会话**不会自动被告知**"工作区有看板、内容 X"——只有模型记得去 board_list 才看到，而这最难。
4. **用户侧无感知**：模型写了什么，用户不主动打开看板页就不知道。

## 方案（按价值排序）

### A. 会话开始自动注入看板摘要（最大杠杆）—— ✅ 已实现（2026-08-17）
- 用 `ctx.systemPrompt.context({ name: 'board:open-items', order: 114, text })`，text 是同步 `(context) => string`。
- **技术前提已验证**：`AssembleContext.agent` 由 `@deepseek-ai/dsh-agent` 通过 `declare module` 扩展，每次装配 `assembleContextFor(agent)` 传入 `{ agent, scope: agent }`，text 里可拿 `agent.session.header.cwd`。
- 实现：`boardSnapshotText()` 按 cwd 同步读 KANBAN.json（新增 `readBoardSync`），只注入**未完成项**（todo + in_progress），控制 token 开销并减少 prompt 前缀抖动；无会话/无 cwd/看板空/读失败 → 返回空串不贡献。
- 验证：`scripts/verify-context.mjs`（注入开放项不含 done、无 agent/无 cwd 为空）。

### B. 关键节点半自动上板 —— ✅ 已并入 D（2026-08-19）
- systemPrompt 引导：收到多步骤任务→ board_add；每完成一步 → board_update；任务结束 → 收尾更新。
- 引导里已有"用户提出多步骤计划 → 逐条 board_add；工作推进 → board_update 移 in_progress/done"；与 D 的收尾纪律合并表述。

### C. 用户侧变更可见性 —— ✅ 已实现（2026-08-19）
- 侧边栏「看板」入口显示未完成计数（角标）：新增 host 路由 `GET /kanban/counts?cwd=` 返回 `{ ok, open }`；`src/client/board-counts.ts` 模块级 observable + 轮询，工作区来自 workspaces feed 最近工作区，并订阅工作区列表变更（数据就绪立即显示，不等 30s 轮询）。wide/rail 状态都有角标，>99 显示 "99+"。
- 看板页打开时每 15s 自动刷新，模型/其他会话写入后自动更新。
- 实测：3080 侧边栏角标 12s 内出现显示 "4"。

### D. 会话结束沉淀（收尾纪律）—— ✅ 已实现（2026-08-19）
- 每轮工作结束，模型把"做了什么、留下什么待办"更新到看板——跨会话连续性由收尾保证。
- 引导新增："Close the loop at the end of every work session: move completed cards to done, add new follow-up as a todo card, update summaries with what was actually done. Do not leave cards in stale states."
- 实测：让模型收尾「删除确认测试卡」，它 board_list → board_update 移到 done 并更新 summary。

### E. 我自己的使用纪律 —— ✅ 已执行
- 每轮开发此项目：先 board_list → 更新看板 → 结束前更新状态。
- 已落实：看板开放项只保留真实待办（当前仅「待办-发 v0.1.2」），过时卡已收尾。

### F. 卡片完整度（三字段纪律）—— ✅ 已实现（2026-08-23）
- 症状：很多会话开始时会建卡，但卡片不完整——只有标题，或有 summary 而无 rationale/rejected。下个会话看不懂"为什么"和"放弃了什么"。
- 根因：系统提示从未点名三字段（创建只说 title/status/tags，收尾只说 update summaries）；schema 全 Optional + "可选"措辞；无反馈回路（缺字段也"成功"）；用户侧不可见。
- 修复（确定性杠杆，每会话必生效）：
  1. `BOARD_GUIDANCE` 重写：创建=title+rationale(为什么) 必写、rejected 有取舍决策就写、summary 完成时写；收尾=done 三字段齐备才关闭；工具输出/会话注入/Web 页同步标注缺字段。
  2. 共享判定 `missingCardFields`（board-core.ts）：每卡必须 rationale；done 卡必须 summary+rationale+rejected。工具 render、`/kanban` 命令、会话注入、Web 页（.kb-card-missing 警告行）、审计脚本全部同一规则。
  3. 反馈回路：`board_add`/`board_update` 返回里缺字段卡片行尾标 `⚠️缺:为什么,…`，另有汇总提示行；会话开始注入对缺 rationale 的开放项标 `(缺:为什么)`。
  4. 验证：`scripts/check-card-discipline.mjs`（静态门禁，断言引导/工具描述/共享谓词/技能口径一致，进 `pnpm test`）+ `scripts/audit-cards.mjs`（KANBAN 完整度审计，可选 --fail 阻塞）。
- 实测：audit-cards 在仓库根发现 1 张 done 卡（侧边栏角标修复）三字段缺失 → 已按 Agent Note 补齐（见 §收尾）。真机模型行为验证见 scripts/verify-guidance*（行为回归）。

### G. kanban-use 技能（深度层，随插件维护）—— ✅ 已实现（2026-08-23）
- 定位：系统提示写不下完整手册（语义/示例/模板）；技能是"按需加载的深度文档"，与插件同一仓库维护（`skills/kanban-use/SKILL.md`）。
- 内容：三件套分工（todo_write/看板/Agent Note）、六字段语义表、好/坏卡对比、创建→推进→收尾流程、关闭检查清单（"下一会话不问人能答三问吗"）、模板速查。
- 安装：`pnpm install:skill`（`scripts/install-skill.mjs`，默认 symlink `~/.agents/skills/kanban-use`，git 更新即生效；`--copy` 实体复制；目标已是实体目录时拒绝 symlink 以免毁数据）。
- 一致性：`check-card-discipline.mjs` 断言 SKILL.md 前端名 `kanban-use`、六工具名、三字段中文语义齐全，且 `src/index.ts` 引导引用该技能。
- **为什么不是"只做技能"**：技能加载靠模型自觉判断，创建卡片那一刻不可靠；流程强化（引导+反馈回路+注入标注）才是确定性主通道。技能解决的是"深度不足"，不是"会不会想起来"。二选一必然失败，混合是唯一正解。

## 建议的实施顺序（已全部完成）

1. **A（自动注入）**：✅ 已实现。已验证 AssembleContext.agent 可由 dsh-agent 的 `declare module` 扩展拿到，`assembleContextFor(agent)` 每次装配传入 `{ agent, scope: agent }`。
2. **D（收尾纪律）**：✅ 已实现。
3. **C（角标）**：✅ 已实现。
4. **B（节点引导强化）**：✅ 已并入 D。
5. **F（卡片完整度）**：✅ 已实现（2026-08-23），见上。
6. **G（kanban-use 技能）**：✅ 已实现（2026-08-23），见上。

## 待验证的技术点（已有结论）

- ✅ `ctx.systemPrompt.context` 的 text 函数里，能通过 `AssembleContext.agent`（dsh-agent `declare module` 扩展）拿到 `agent.session.header.cwd`。
- ⚠️ context 注入的 KV cache 前缀稳定性：只注入未完成项（todo + in_progress），done 卡片 churn 不注入，减少前缀抖动；但仍需留意看板内容变化对前缀的影响（README 已明示该取舍）。
