import { describe, expect, test } from 'vitest'
import { buildBattleResult, computeBail } from './result'
import type { BattleState } from './types'

function mkState(over: Partial<BattleState>): BattleState {
  return {
    grid: { cols: 3, rows: 3 }, obstacles: [],
    units: [
      { id: 'p0', side: 'player', defId: 'militia', count: 30, position: { q: 0, r: 0 }, size: 1, hpLeft: 300, maxHp: 300, hasActed: false, hasMoved: false, retaliated: false },
      { id: 'e0', side: 'enemy', defId: 'cavalry', count: 8, position: { q: 1, r: 0 }, size: 2, hpLeft: 240, maxHp: 240, hasActed: false, hasMoved: false, retaliated: false }
    ],
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, completedQueue: [], normalQueue: ['p0', 'e0'], waitQueue: [], currentUnitId: 'p0',
    selectedUnitId: null, phase: 'combat', outcome: null, enter: { playerGold: 10000, opponentKind: 'faction' }, log: [],
    ...over
  }
}

describe('computeBail', () => {
  test('150% 剩余部队金币价值：民兵30×50 + 骑兵8×200 = 1500+1600=3100 → 4650', () => {
    expect(computeBail(mkState({}))).toBe(4650)
  })
  test('阵亡单位不计入（units 只剩存活）', () => {
    expect(computeBail(mkState({ units: mkState({}).units.filter((u) => u.id === 'p0') }))).toBe(Math.round(30 * 50 * 1.5))
  })
})

describe('buildBattleResult', () => {
  test('议和：outcome=negotiated、goldSettlement=-bail、部队保留、generalCaptured=false', () => {
    const r = buildBattleResult(mkState({ phase: 'negotiated', outcome: 'negotiated' }))
    expect(r.outcome).toBe('negotiated')
    expect(r.goldSettlement).toBe(-4650)
    expect(r.remainingTroops).toHaveLength(2)
    expect(r.generalCaptured).toBe(false)
    expect(r.expGained).toBe(0)
  })
  test('投降：outcome=surrendered、部队清零、generalCaptured=true', () => {
    const r = buildBattleResult(mkState({ phase: 'lost', outcome: 'surrendered' }))
    expect(r.outcome).toBe('surrendered')
    expect(r.remainingTroops).toEqual([])
    expect(r.generalCaptured).toBe(true)
  })
  test('逃跑：outcome=fled、部队清零、generalCaptured=false、goldSettlement=0', () => {
    const r = buildBattleResult(mkState({ phase: 'fled', outcome: 'fled' }))
    expect(r.outcome).toBe('fled')
    expect(r.remainingTroops).toEqual([])
    expect(r.generalCaptured).toBe(false)
    expect(r.goldSettlement).toBe(0)
  })
  test('自然战败：generalCaptured=null（探索层决定 30% 逃跑）', () => {
    expect(buildBattleResult(mkState({ phase: 'lost', outcome: 'lost' })).generalCaptured).toBeNull()
  })
})
