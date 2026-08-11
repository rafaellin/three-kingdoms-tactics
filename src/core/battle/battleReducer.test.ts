import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
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
