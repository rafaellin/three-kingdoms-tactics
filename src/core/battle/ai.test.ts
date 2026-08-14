import { describe, expect, test } from 'vitest'
import { planEnemyAction } from './ai'
import type { BattleState, BattleUnit } from './types'

function unit(over: Partial<BattleUnit>): BattleUnit {
  return {
    id: 'u', side: 'enemy', defId: 'militia', count: 10, position: { q: 0, r: 0 },
    size: 1, hpLeft: 10, maxHp: 10, hasActed: false, hasMoved: false, retaliated: false, ...over
  }
}
function state(enemy: BattleUnit, foes: BattleUnit[]): BattleState {
  return {
    grid: { cols: 13, rows: 9 },
    units: [enemy, ...foes],
    obstacles: [],
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, completedQueue: [], normalQueue: [enemy.id], waitQueue: [], currentUnitId: enemy.id, selectedUnitId: null, phase: 'combat', outcome: null, log: []
  }
}

describe('planEnemyAction（冲锋/射击）', () => {
  test('够得着 → 冲锋：返回 attack 带落点（优先低血）', () => {
    const foeLow = unit({ id: 'p1', side: 'player', position: { q: 3, r: 0 }, hpLeft: 5 })
    const foeHigh = unit({ id: 'p0', side: 'player', position: { q: 0, r: 1 }, hpLeft: 50 })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    const a = planEnemyAction(state(enemy, [foeLow, foeHigh]))
    expect(a.type).toBe('attack')
    if (a.type === 'attack') expect(a.targetId).toBe('p1')
  })
  test('已贴身 → 原地攻击（to=当前格）', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 1, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'attack', targetId: 'p0', to: { q: 0, r: 0 } })
  })
  test('距离 2 也冲锋（可达落点相邻）', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 2, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'attack', targetId: 'p0', to: { q: 1, r: 0 } })
  })
  test('1×2 骑兵：东邻体格相邻即可冲锋（主格不贴但东邻格贴）', () => {
    // 敌骑兵主格 (0,0) body (0,0)+(1,0)，我方 (3,0)。冲锋到主格 (1,0)，东邻格 (2,0) 贴 (3,0) → 够得着
    const foe = unit({ id: 'p0', side: 'player', position: { q: 3, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'cavalry', position: { q: 0, r: 0 }, size: 2 })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'attack', targetId: 'p0', to: { q: 1, r: 0 } })
  })
  test('远程：射程内 → shoot', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 0, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'archer', position: { q: 6, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'shoot', targetId: 'p0' })
  })
  test('远程：射程外 → 走近', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 0, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'archer', position: { q: 7, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('够不着 → 向最近敌人移动', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 0, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia', position: { q: 6, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('无敌人 → endTurn', () => {
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [])).type).toBe('endTurn')
  })
})
