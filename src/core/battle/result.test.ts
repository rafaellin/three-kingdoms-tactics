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
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] }, enemy: { name: 'E', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] } },
    turn: 1, completedQueue: [], normalQueue: ['p0', 'e0'], waitQueue: [], currentUnitId: 'p0',
    selectedUnitId: null, phase: 'combat', outcome: null, enter: { playerGold: 10000, opponentKind: 'faction' },
    killedHp: { player: 0, enemy: 0 }, log: [],
    ...over
  }
}

describe('computeBail', () => {
  test('150% 玩家剩余部队金币价值：民兵30×50 = 1500 → 2250（敌方骑兵 8×200 不计入）', () => {
    expect(computeBail(mkState({}))).toBe(2250)
  })
  test('阵亡玩家单位不计入：玩家全灭（units 只剩敌方）→ 保释金 0', () => {
    expect(computeBail(mkState({ units: mkState({}).units.filter((u) => u.side === 'enemy') }))).toBe(0)
  })
})

describe('buildBattleResult', () => {
  test('议和：outcome=negotiated、goldSettlement=-bail、我方部队保留、generalCaptured=false', () => {
    const r = buildBattleResult(mkState({ phase: 'negotiated', outcome: 'negotiated' }))
    expect(r.outcome).toBe('negotiated')
    expect(r.goldSettlement).toBe(-2250)
    expect(r.remainingTroops).toEqual([{ defId: 'militia', count: 30 }])
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

  test('战胜：expGained = 我方歼灭敌方 hp×count 总和（round）', () => {
    const r = buildBattleResult(mkState({
      phase: 'won',
      outcome: 'won',
      killedHp: { player: 312.6, enemy: 40 }
    }))
    expect(r.outcome).toBe('won')
    expect(r.expGained).toBe(313) // round(312.6)
  })

  test('非战胜（战败/降/逃/和）：expGained = 0，即使我方有歼灭', () => {
    const killed = { player: 312, enemy: 0 }
    expect(buildBattleResult(mkState({ phase: 'lost', outcome: 'lost', killedHp: killed })).expGained).toBe(0)
    expect(buildBattleResult(mkState({ phase: 'lost', outcome: 'surrendered', killedHp: killed })).expGained).toBe(0)
    expect(buildBattleResult(mkState({ phase: 'fled', outcome: 'fled', killedHp: killed })).expGained).toBe(0)
    expect(buildBattleResult(mkState({ phase: 'negotiated', outcome: 'negotiated', killedHp: killed })).expGained).toBe(0)
  })
})
