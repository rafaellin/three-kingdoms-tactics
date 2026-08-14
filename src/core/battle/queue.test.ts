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
  it('按 state.order 顺序产出条目，透传 side/defId/hasActed', () => {
    const units = [
      unit('p1', { defId: 'militia', hasActed: true }),
      unit('p0', { defId: 'cavalry' }),
      unit('e0', { side: 'enemy', defId: 'archer' })
    ]
    const q = buildTurnOrderQueue({ order: ['e0', 'p1', 'p0'], units })
    expect(q.map((e) => e.unitId)).toEqual(['e0', 'p1', 'p0'])
    expect(q[0]).toEqual({ unitId: 'e0', side: 'enemy', defId: 'archer', hasActed: false })
    expect(q[1]).toEqual({ unitId: 'p1', side: 'player', defId: 'militia', hasActed: true })
    expect(q[2]).toEqual({ unitId: 'p0', side: 'player', defId: 'cavalry', hasActed: false })
  })

  it('跳过已在 order 但已阵亡（不在 units 中）的单位', () => {
    const units = [unit('p0'), unit('p2')]
    const q = buildTurnOrderQueue({ order: ['p0', 'e0', 'p1', 'p2'], units })
    expect(q.map((e) => e.unitId)).toEqual(['p0', 'p2'])
  })

  it('order 重建（跨回合重排）后队列随之变化', () => {
    const units = [
      unit('p0', { defId: 'cavalry' }),
      unit('p1', { defId: 'archer' }),
      unit('p2', { defId: 'militia' })
    ]
    const firstRound = buildTurnOrderQueue({ order: ['p0', 'p1', 'p2'], units })
    expect(firstRound.map((e) => e.defId)).toEqual(['cavalry', 'archer', 'militia'])
    const nextRound = buildTurnOrderQueue({ order: ['p1', 'p0', 'p2'], units })
    expect(nextRound.map((e) => e.unitId)).toEqual(['p1', 'p0', 'p2'])
  })
})
