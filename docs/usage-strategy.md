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

### B. 关键节点半自动上板
- systemPrompt 引导：收到多步骤任务→ board_add；每完成一步 → board_update；任务结束 → 收尾更新。
- 让"完成一步后必须更新状态"成为纪律（类似 todo_write 的强制感），不靠自觉。

### C. 用户侧变更可见性
- 侧边栏「看板」入口显示未完成计数（角标），人知道有东西待办。
- 看板页在模型写入后自动刷新（当前打开才加载）。

### D. 会话结束沉淀（收尾纪律）
- 每轮工作结束，模型把"做了什么、留下什么待办"更新到看板——跨会话连续性由收尾保证。
- 已有 2 张开发卡（当前阶段 in_progress / 待办 todo）作为起点。

### E. 我自己的使用纪律
- 每轮开发此项目：先 board_list → 更新看板 → 结束前更新状态。
- 已开始：补记了开发待办卡 + Agent Note（审计/发版决策）。

## 建议的实施顺序

1. **A（自动注入）**：杠杆最大，先做。需先验证 context 动态函数能否按 agent cwd 读工作区看板。
2. **D（收尾纪律）**：成本最低，配合 A 立刻见效。
3. **C（角标）**：用户侧可见性，中等成本。
4. **B（节点引导强化）**：在 A 之后增强。

## 待验证的技术点
- `ctx.systemPrompt.context` 的 text 函数里，能否从 AssembleContext.scope 拿到 agent → session.cwd？
- context 注入是否会造成 KV cache 前缀不稳定（每次看板内容变 → prompt 变）？
