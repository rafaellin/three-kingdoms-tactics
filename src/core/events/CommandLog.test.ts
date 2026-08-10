import { describe, expect, test } from 'vitest'
import { CommandLog, type Reducer } from './CommandLog'

interface Counter {
  n: number
}

const reducer: Reducer<Counter> = (s, cmd) => {
  switch (cmd.type) {
    case 'inc':
      return { n: s.n + ((cmd.payload as { by?: number } | undefined)?.by ?? 1) }
    case 'reset':
      return { n: 0 }
    default:
      return s
  }
}

describe('CommandLog（命令日志 + 确定性）', () => {
  test('dispatch 追加命令并驱动状态', () => {
    const log = new CommandLog<Counter>({ n: 0 }, reducer)
    log.dispatch('inc')
    log.dispatch('inc', { by: 2 })
    expect(log.getState()).toEqual({ n: 3 })
    expect(log.getLog().map((c) => c.type)).toEqual(['inc', 'inc'])
  })

  test('每条命令带递增 seq', () => {
    const log = new CommandLog<Counter>({ n: 0 }, reducer)
    log.dispatch('inc')
    log.dispatch('inc', { by: 5 })
    expect(log.getLog().map((c) => c.seq)).toEqual([0, 1])
  })

  test('相同命令序列 + 相同 reducer 得到相同终态（确定性）', () => {
    const seq = ['inc', 'reset', 'inc', 'inc', 'inc']
    const run = () => {
      const log = new CommandLog<Counter>({ n: 0 }, reducer)
      for (const t of seq) log.dispatch(t)
      return log.getState()
    }
    expect(run()).toEqual(run())
  })

  test('replay 返回终态且不改动原日志', () => {
    const log = new CommandLog<Counter>({ n: 1 }, reducer)
    const cmds = [
      { type: 'inc', payload: { by: 4 }, seq: 0 },
      { type: 'inc', payload: { by: 5 }, seq: 1 }
    ]
    const end = CommandLog.replay({ n: 1 }, reducer, cmds)
    expect(end).toEqual({ n: 10 })
    expect(log.getState()).toEqual({ n: 1 })
  })
})
