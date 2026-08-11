import { describe, expect, test } from 'vitest'
import { hexKey } from '../hex/HexGrid'
import { battleFindPath, battleReachableArea } from './pathing'
import type { BattleState, BattleUnit } from './types'

function makeUnit(over: Partial<BattleUnit>): BattleUnit {
  return {
    id: 'u0', side: 'player', defId: 'militia', count: 10, position: { q: 0, r: 0 },
    size: 1, hpLeft: 10, maxHp: 10, hasActed: false, hasMoved: false, ...over
  }
}

function makeState(units: BattleUnit[], grid: { cols: number; rows: number } = { cols: 20, rows: 20 }): BattleState {
  return {
    grid,
    units,
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, order: units.map((u) => u.id), currentUnitId: units[0]?.id ?? null, selectedUnitId: null, phase: 'combat', log: []
  }
}

describe('战斗寻路（全平地，障碍 = 其他单位）', () => {
  test('移动力 = 兵种 speed（无遮挡平地）', () => {
    // 起点放网格中心 (10,10)，避免角点把可达集裁剪掉；
    // speed4 → 六角球内 1+6+12+18+24 = 61 格全部落在 20×20 界内
    const s = makeState([makeUnit({ defId: 'militia', position: { q: 10, r: 10 } })])
    expect(battleReachableArea(s.units[0]!, s)).toHaveLength(61)
  })
  test('他单位占据格不可走（含 1×2 双格）', () => {
    // 敌人骑兵 size2 占 (2,2)+(3,2)
    const enemy = makeUnit({ id: 'e0', side: 'enemy', defId: 'cavalry', position: { q: 2, r: 2 }, size: 2 })
    const s = makeState([makeUnit({ defId: 'cavalry' }), enemy])
    const reach = battleReachableArea(s.units[0]!, s)
    expect(reach.some((h) => hexKey(h) === '2,2')).toBe(false)
    expect(reach.some((h) => hexKey(h) === '3,2')).toBe(false)
  })
  test('1×2 单位移动时双格校验：目标东邻被占则不可达', () => {
    const blocker = makeUnit({ id: 'b', side: 'enemy', defId: 'militia', position: { q: 3, r: 0 } })
    const mover = makeUnit({ id: 'u0', defId: 'cavalry', position: { q: 0, r: 0 }, size: 2 })
    const s = makeState([mover, blocker])
    // 骑兵到 (2,0) 需占 (2,0)+(3,0)，而 (3,0) 被占 → 不可达
    expect(battleReachableArea(mover, s).some((h) => hexKey(h) === '2,0')).toBe(false)
  })
  test('battleFindPath 返回路径或 null（越界/被占 → null）', () => {
    const s = makeState([makeUnit({ defId: 'militia' })])
    expect(battleFindPath(s.units[0]!, { q: 2, r: 0 }, s)).not.toBeNull()
    const s2 = makeState([makeUnit({ defId: 'militia' }), makeUnit({ id: 'e0', side: 'enemy', position: { q: 2, r: 0 } })])
    expect(battleFindPath(s2.units[0]!, { q: 2, r: 0 }, s2)).toBeNull()
  })
})
