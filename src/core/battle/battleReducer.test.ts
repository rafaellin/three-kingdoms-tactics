import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { hexKey } from '../hex/HexGrid'
import { battleReducer, createInitialBattleState } from './battleReducer'
import type { BattleArmyConfig, BattleState } from './types'

const TEST_GRID = { cols: 13, rows: 9 }
const TEST_ARMIES = {
  player: { side: 'player' as const, generalName: '关羽', atkBonus: 30, defBonus: 23,
    units: [{ defId: 'militia', count: 30 }, { defId: 'cavalry', count: 8 }] },
  enemy: { side: 'enemy' as const, generalName: '吕布', atkBonus: 33, defBonus: 27,
    units: [{ defId: 'archer', count: 8 }] }
}

function makeStore(opts?: { player?: BattleArmyConfig; enemy?: BattleArmyConfig; grid?: { cols: number; rows: number } }) {
  const store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
  store.dispatch('battle/init', {
    player: opts?.player ?? TEST_ARMIES.player,
    enemy: opts?.enemy ?? TEST_ARMIES.enemy,
    grid: opts?.grid ?? TEST_GRID
  })
  return store
}

describe('battle/init', () => {
  test('布置单位：hp = 命×count、按速度降序排行动序', () => {
    const s = makeStore().getState()
    expect(s.phase).toBe('combat')
    expect(s.units).toHaveLength(3)
    const mil = s.units.find((u) => u.defId === 'militia')
    expect(mil?.maxHp).toBe(30)   // 30 × hp1
    expect(mil?.hpLeft).toBe(30)
    // 骑兵 speed9 > 弓兵5 > 民兵4 → 行动序 [cavalry, archer, militia]
    const cavalryId = s.units.find((u) => u.defId === 'cavalry')?.id
    expect(s.order[0]).toBe(cavalryId)
    expect(s.currentUnitId).toBe(cavalryId)
  })
  test('玩家单位在左 (q=0)、敌方在右 (q=cols-2)', () => {
    const s = makeStore().getState()
    expect(s.units.filter((u) => u.side === 'player').every((u) => u.position.q === 0)).toBe(true)
    expect(s.units.find((u) => u.side === 'enemy')?.position.q).toBe(s.grid.cols - 2)
  })
})

describe('battle/endTurn 回合推进', () => {
  test('行动完跳到下一单位；全动完 turn+1 重排', () => {
    const store = makeStore()
    const ids = store.getState().order
    for (const id of ids.slice(0, -1)) {
      store.dispatch('battle/endTurn', { unitId: id })
      expect(store.getState().currentUnitId).toBe(ids[ids.indexOf(id) + 1])
    }
    store.dispatch('battle/endTurn', { unitId: ids[ids.length - 1] as string })
    const s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.units.every((u) => !u.hasActed && !u.hasMoved)).toBe(true)
  })
  test('非当前单位 endTurn 为 no-op', () => {
    const store = makeStore()
    const s0 = store.getState()
    const other = s0.units.find((u) => u.id !== s0.currentUnitId)!
    store.dispatch('battle/endTurn', { unitId: other.id })
    expect(store.getState().currentUnitId).toBe(s0.currentUnitId)
  })
})

describe('battle/select', () => {
  test('只能选中玩家单位；可取消', () => {
    const store = makeStore()
    const p = store.getState().units.find((u) => u.side === 'player')!
    store.dispatch('battle/select', { unitId: p.id })
    expect(store.getState().selectedUnitId).toBe(p.id)
    store.dispatch('battle/select', { unitId: null })
    expect(store.getState().selectedUnitId).toBeNull()
  })
  test('选中敌方单位无效', () => {
    const store = makeStore()
    const e = store.getState().units.find((u) => u.side === 'enemy')!
    store.dispatch('battle/select', { unitId: e.id })
    expect(store.getState().selectedUnitId).toBeNull()
  })
})

describe('battle/move', () => {
  test('移动到可达格更新位置，并置 hasMoved', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId! // 骑兵（speed9，出生 (0,1)）
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })
    const u = store.getState().units.find((x) => x.id === cur)!
    expect(hexKey(u.position)).toBe('1,0')
    expect(u.hasMoved).toBe(true)
  })
  test('不可达/越界/已移动 均为 no-op', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId! // 骑兵 (0,1)
    store.dispatch('battle/move', { unitId: cur, to: { q: 99, r: 99 } }) // 越界 → no-op
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('0,1')
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })  // 合法移动
    store.dispatch('battle/move', { unitId: cur, to: { q: 2, r: 0 } })  // 已移动 → no-op
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('1,0')
  })
})

describe('battle/attack', () => {
  test('远程在射程内攻击：扣目标 hp、折算 count、攻击者行动', () => {
    // 小图 4×3：玩家 archer (0,0)、敌方 militia (2,0)，距离 2 ≤ 射程 2
    // archer speed5 > militia speed4 → 玩家 p0 先动（避免同速 id 平局陷阱）
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: '关羽', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: '吕布', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    expect(store.getState().currentUnitId).toBe('p0')
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    // 攻6 防4 差2 → 伤害 10×3×1.1 = 33；敌方 militia hp=50 → 剩 17，count = ceil(17/1) = 17
    const t = s.units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(17)
    expect(t.count).toBe(17)
    expect(s.phase).toBe('combat')
    expect(s.units.find((u) => u.id === 'p0')!.hasActed).toBe(true)
    expect(s.currentUnitId).toBe('e0') // advance 到敌方未行动单位
  })
  test('灭队即判胜', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: '关羽', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: '吕布', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 8 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
  })
  test('近战需相邻：不相邻攻击为 no-op', () => {
    const store = makeStore()
    const s0 = store.getState()
    const cur = s0.currentUnitId! // 骑兵 (0,1)，敌方 archer (11,0) 距离远
    const enemyId = s0.units.find((u) => u.side === 'enemy')!.id
    store.dispatch('battle/attack', { unitId: cur, targetId: enemyId })
    const s = store.getState()
    expect(s.phase).toBe('combat')
    expect(s.units.find((u) => u.side === 'enemy')).toBeDefined()
    expect(s.currentUnitId).toBe(cur) // 未行动 → 当前单位不变
  })
})
