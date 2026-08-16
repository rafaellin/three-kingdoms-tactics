import { describe, expect, test } from 'vitest'
import { hexKey } from '../hex/HexGrid'
import type { Axial } from '../hex/HexGrid'
import { battleFindPath, battleReachableArea, battleGridConnected, canStandAt, inBattleGrid } from './pathing'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

function makeUnit(over: Partial<BattleUnit>): BattleUnit {
  return {
    id: 'u0', side: 'player', defId: 'militia', count: 10, position: { q: 0, r: 0 },
    size: 1, hpLeft: 10, maxHp: 10, hasActed: false, hasMoved: false, retaliated: false, ...over
  }
}

function makeState(
  units: BattleUnit[],
  grid: { cols: number; rows: number } = { cols: 20, rows: 20 },
  obstacles: Axial[] = []
): BattleState {
  return {
    grid,
    units,
    obstacles,
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] }, enemy: { name: 'E', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] } },
    turn: 1, completedQueue: [], normalQueue: units.map((u) => u.id), waitQueue: [], currentUnitId: units[0]?.id ?? null, selectedUnitId: null, phase: 'combat', outcome: null, killedHp: { player: 0, enemy: 0 }, log: []
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

describe('1×2 骑兵可达范围边界保证（回归）', () => {
  /** 网格上所有合法 1×2 主格（双格都在界内） */
  function validMains(state: BattleState): Axial[] {
    const out: Axial[] = []
    for (let r = 0; r < state.grid.rows; r++) {
      const qMin = -Math.floor(r / 2)
      for (let q = qMin; q <= qMin + state.grid.cols - 1; q++) {
        const m = makeUnit({ id: 'x', defId: 'cavalry', position: { q, r }, size: 2 })
        if (canStandAt(m, state, { q, r })) out.push({ q, r })
      }
    }
    return out
  }

  test('每个合法骑兵起始位：所有可达落点的双格都在界内（无出界）', () => {
    const s = makeState([], { cols: 13, rows: 9 })
    let bad = 0
    for (const start of validMains(s)) {
      const cav = makeUnit({ id: 'u0', defId: 'cavalry', position: start, size: 2 })
      for (const p of battleReachableArea(cav, s)) {
        for (const h of occupiedHexes({ position: p, size: 2 })) {
          if (!inBattleGrid(s, h)) bad++
        }
      }
    }
    expect(bad).toBe(0)
  })

  test('可达范围从两头都覆盖：主格 ±speed 极端可达（而非只一头）', () => {
    // 骑兵 main (15,4) body (15,4)+(16,4)，speed 9 → 主格可达 (15±9, 4)
    const cav = makeUnit({ id: 'u0', defId: 'cavalry', position: { q: 15, r: 4 }, size: 2 })
    const s = makeState([cav], { cols: 30, rows: 9 })
    const reach = battleReachableArea(cav, s).map(hexKey)
    expect(reach.includes('6,4')).toBe(true)  // 西端 main 15-9
    expect(reach.includes('24,4')).toBe(true) // 东端 main 15+9（body 到 25,4）
  })
})

describe('矩形战场窗口 / 障碍物 / 连通性', () => {
  test('矩形窗口：qMin(r)=-floor(r/2)，行内 q∈[qMin, qMin+cols-1]', () => {
    const s = makeState([], { cols: 4, rows: 3 })
    expect(inBattleGrid(s, { q: 0, r: 0 })).toBe(true)
    expect(inBattleGrid(s, { q: 3, r: 0 })).toBe(true)
    expect(inBattleGrid(s, { q: 4, r: 0 })).toBe(false)   // 超行宽
    expect(inBattleGrid(s, { q: 3, r: 2 })).toBe(false)   // 锯齿左进：行2窗口 [-1,2]
    expect(inBattleGrid(s, { q: -1, r: 2 })).toBe(true)
    expect(inBattleGrid(s, { q: 0, r: 3 })).toBe(false)   // 行越界
  })
  test('障碍格不可通行', () => {
    const s = makeState([makeUnit({ defId: 'militia' })], { cols: 13, rows: 9 }, [{ q: 2, r: 0 }])
    const reach = battleReachableArea(s.units[0]!, s)
    expect(reach.some((h) => hexKey(h) === '2,0')).toBe(false)
    expect(reach.some((h) => hexKey(h) === '1,0')).toBe(true)
  })
  test('1×2 单位东邻是障碍则不可占', () => {
    const s = makeState([makeUnit({ defId: 'cavalry', position: { q: 4, r: 0 }, size: 2 })], { cols: 13, rows: 9 }, [{ q: 6, r: 0 }])
    expect(battleReachableArea(s.units[0]!, s).some((h) => hexKey(h) === '5,0')).toBe(false)
  })
  test('连通性：固定测试图连通（无孤岛）', () => {
    const obs: Axial[] = [{ q: 4, r: 0 }, { q: 5, r: 0 }, { q: 4, r: 2 }, { q: 5, r: 2 }, { q: 7, r: 4 }, { q: 8, r: 4 }]
    const s = makeState([], { cols: 13, rows: 9 }, obs)
    expect(battleGridConnected(s)).toBe(true)
  })
  test('连通性：整列障碍制造孤岛 → 不连通', () => {
    const wall: Axial[] = [{ q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 }, { q: 3, r: 3 }, { q: 3, r: 4 }]
    const s = makeState([], { cols: 8, rows: 5 }, wall)
    expect(battleGridConnected(s)).toBe(false)
  })
})
