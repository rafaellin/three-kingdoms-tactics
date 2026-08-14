import { describe, expect, it } from 'vitest'
import { buildTurnOrderQueue } from './queue'
import type { BattleUnit } from './types'

function unit(id: string, over: Partial<BattleUnit> = {}): BattleUnit {
  return {
    id,
    side: 'player',
    defId: 'militia',
    count: 10,
    position: { q: 0, r: 0 },
    size: 1,
    hpLeft: 100,
    maxHp: 100,
    hasActed: false,
    hasMoved: false,
    retaliated: false,
    ...over
  }
}

describe('buildTurnOrderQueue', () => {
  it('按 completedQueue → normalQueue → waitQueue 顺序产出条目，透传 side/defId/hasActed/segment', () => {
    const units = [
      unit('p1', { defId: 'militia', hasActed: true }),
      unit('p0', { defId: 'cavalry' }),
      unit('e0', { side: 'enemy', defId: 'archer' })
    ]
    const q = buildTurnOrderQueue({ completedQueue: ['p1'], normalQueue: ['e0', 'p0'], waitQueue: [], units })
    expect(q.map((e) => e.unitId)).toEqual(['p1', 'e0', 'p0'])
    expect(q[0]).toEqual({ unitId: 'p1', side: 'player', defId: 'militia', hasActed: true, segment: 'done' })
    expect(q[1]).toEqual({ unitId: 'e0', side: 'enemy', defId: 'archer', hasActed: false, segment: 'normal' })
    expect(q[2]).toEqual({ unitId: 'p0', side: 'player', defId: 'cavalry', hasActed: false, segment: 'normal' })
  })

  it('跳过已在队列但已阵亡（不在 units 中）的单位', () => {
    const units = [unit('p0'), unit('p2')]
    const q = buildTurnOrderQueue({ completedQueue: ['p0'], normalQueue: ['e0', 'p1', 'p2'], waitQueue: [], units })
    expect(q.map((e) => e.unitId)).toEqual(['p0', 'p2'])
  })

  it('waitQueue 段映射为 segment="wait"', () => {
    const units = [
      unit('p0', { defId: 'cavalry' }),
      unit('p1', { defId: 'archer' }),
      unit('p2', { defId: 'militia' })
    ]
    const q = buildTurnOrderQueue({ completedQueue: [], normalQueue: ['p0', 'p1'], waitQueue: ['p2'], units })
    expect(q.map((e) => e.unitId)).toEqual(['p0', 'p1', 'p2'])
    expect(q[2]!.segment).toBe('wait')
  })
})
