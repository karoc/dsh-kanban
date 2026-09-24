# Negative guarantees (pinned by test titles)

This plugin owns the user's `KANBAN.json`. The rows below are the promises that
must not drift: **no data loss**, **fail loud instead of silently repairing**,
and **no silent write outside the documented files**. The third column is the
test title that pins each row — `scripts/check-guarantees.mjs` fails `npm test`
when a title disappears, so a guarantee cannot be quietly dropped.

| id | guarantee | pinned by |
|---|---|---|
| G1 | 卡片**永不因归档被删除**：超出 `MAX_DONE_CARDS`（100）的 done 卡被**归档**到 `.agents/notes/archive.json`，最旧优先 | `done cards beyond MAX_DONE_CARDS are archived to .agents/notes/archive.json` |
| G2 | 结构损坏的 `KANBAN.json` **fail loud**，绝不静默修复（手改出错不会悄悄丢数据） | `readBoard fails loud on a structurally broken file` |
| G3 | 非法 JSON 同样 **fail loud**（不覆盖、不清空） | `readBoard fails loud on invalid JSON` |
| G4 | 空标题 / 纯空白标题的建卡被**拒绝** | `addCard rejects empty or whitespace-only titles` |
| G5 | 未知状态被**拒绝**（不会写出非法 status） | `addCard rejects unknown statuses` |
| G6 | 未知 id 的更新被**拒绝**（不会误建一张新卡） | `updateCard rejects unknown ids` |
| G7 | `updateCard` **至少要求一个字段**（不接受空操作写盘） | `updateCard requires at least one field` |
| G8 | 工作区路径**必须是绝对路径**（不会把看板写到相对位置） | `boardPath requires an absolute workspace` |
| G9 | 标签被**归一**：trim、丢弃空项、去重（同一标签不会重复出现） | `addCard normalizes tags (trim, drop empties, dedupe)` |
| G10 | 三字段（what/why/rejected）的**形状校验**会拒绝非法值 | `shape guards accept valid values and reject invalid ones` |
| G11 | 没有 staged 会话时（如全局面板打开）`currentSessionId` 为 **undefined**，不会误判工作区 | `currentSessionId is undefined with no staged session (global panel open)` |
| G12 | 空的 legacy `current` 字段被**忽略**（不被当成 staged） | `currentSessionId ignores an empty legacy` |
| G13 | 目标文件被短暂占用（Windows EPERM 竞态）时 `renameWithRetry` **重试成功**，不丢写入 | `renameWithRetry succeeds when the target is briefly held open (Windows EPERM race)` |
