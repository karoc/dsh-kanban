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

## 建议的实施顺序（已全部完成）

1. **A（自动注入）**：✅ 已实现。已验证 AssembleContext.agent 可由 dsh-agent 的 `declare module` 扩展拿到，`assembleContextFor(agent)` 每次装配传入 `{ agent, scope: agent }`。
2. **D（收尾纪律）**：✅ 已实现。
3. **C（角标）**：✅ 已实现。
4. **B（节点引导强化）**：✅ 已并入 D。

## 待验证的技术点（已有结论）

- ✅ `ctx.systemPrompt.context` 的 text 函数里，能通过 `AssembleContext.agent`（dsh-agent `declare module` 扩展）拿到 `agent.session.header.cwd`。
- ⚠️ context 注入的 KV cache 前缀稳定性：只注入未完成项（todo + in_progress），done 卡片 churn 不注入，减少前缀抖动；但仍需留意看板内容变化对前缀的影响（README 已明示该取舍）。
