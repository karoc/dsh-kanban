// Compatibility layer for dsh's tool-execution API across the 0.2.2-alpha.2
// refactor ("separate scoped executors from tool registration"):
//   · dsh ≤ 0.2.1        — ctx.tools.execute({callId,name,arguments,agent,signal})
//                          executes one registered tool directly.
//   · dsh ≥ 0.2.2-alpha.2 — an executor must be selected in the composition
//                          (`ctx.plugin(@deepseek-ai/dsh-tool-executor-native)`) and
//                          ctx.tools.execute takes a batch: {calls,agent?,signal?}
//                          where ToolCallBlock.arguments is the raw JSON string.
// Harness scripts import this so the same gate runs against both generations.

/** Whether the mounted runtime uses the batch executor API. @param ctx cordis context. @returns true on dsh ≥ 0.2.2-alpha.2. */
export function hasBatchToolApi(ctx) {
  return typeof ctx.tools?.setExecutor === 'function'
}

/**
 * Select the native executor when the runtime requires one.
 * Pre-0.2.2 runtimes have no executor service, so this is a no-op there.
 * @param ctx cordis context that already mounted ToolRuntime.
 * @returns true when an executor was selected.
 */
export async function installToolExecutor(ctx) {
  if (!hasBatchToolApi(ctx)) return false
  try {
    const executor = await import('@deepseek-ai/dsh-tool-executor-native')
    await ctx.plugin(executor)
    return true
  } catch {
    // Dependency not installed (pre-0.2.2 checkout): the runtime executes
    // registered tools without an executor, so the harness can proceed.
    return false
  }
}

/**
 * Execute one tool call through either API generation.
 * @param ctx cordis context.
 * @param call {callId,name,arguments,agent?,signal?} in the pre-0.2.2 shape.
 * @returns the ToolExecutionResult (content blocks).
 */
export async function executeTool(ctx, call) {
  if (!hasBatchToolApi(ctx)) return ctx.tools.execute(call)
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) }],
    signal: call.signal,
    agent: call.agent,
  })
  const first = batch.results[0]
  if (first === undefined) throw new Error('tool batch returned no result for ' + call.name)
  return first.result
}
