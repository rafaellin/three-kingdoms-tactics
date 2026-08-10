/**
 * 命令日志：确定性事件溯源基础设施。
 *
 * 每个游戏操作都是一个 command，追加进日志、经 reducer 驱动状态。
 * 状态 = reducer 折叠（全部命令）。相同命令序列 + 相同 reducer ⇒ 相同终态，
 * 这保证了 bug 可精确复现、存档/回放/无头 AI 模拟可行。
 *
 * core 内禁止裸 Math.random / Date.now；随机统一走注入的 RNG。
 */

export interface Command {
  type: string
  /** 单调递增序号，标识唯一操作 */
  seq: number
  payload?: unknown
}

export type Reducer<S> = (state: S, cmd: Command) => S

export class CommandLog<S> {
  private readonly commands: Command[] = []
  private state: S
  private nextSeq = 0

  constructor(initial: S, private readonly reducer: Reducer<S>) {
    this.state = initial
  }

  getState(): S {
    return this.state
  }

  getLog(): readonly Command[] {
    return this.commands
  }

  dispatch(type: string, payload?: unknown): void {
    const cmd: Command = { type, seq: this.nextSeq++, payload }
    this.commands.push(cmd)
    this.state = this.reducer(this.state, cmd)
  }

  /** 用给定命令序列折叠出终态，不触碰调用方状态（纯函数） */
  static replay<S>(base: S, reducer: Reducer<S>, commands: readonly Command[]): S {
    return commands.reduce(reducer, base)
  }
}
