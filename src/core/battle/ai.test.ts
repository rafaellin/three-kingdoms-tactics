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
    obstacles: [],
    units: [enemy, ...foes],
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, order: [enemy.id], currentUnitId: enemy.id, selectedUnitId: null, phase: 'combat', log: []
  }
}

describe('planEnemyAction（简易 AI）', () => {
  test('范围内有敌人 → 攻击（优先低血量）', () => {
    // 两个敌人都距 1、在射程内：血低者优先
    const foeLow = unit({ id: 'p1', side: 'player', position: { q: 1, r: 0 }, hpLeft: 5 })
    const foeHigh = unit({ id: 'p0', side: 'player', position: { q: 0, r: 1 }, hpLeft: 50 })
    const enemy = unit({ id: 'e0', defId: 'militia' }) // range 1
    const s = state(enemy, [foeLow, foeHigh])
    const action = planEnemyAction(s)
    expect(action.type).toBe('attack')
    if (action.type === 'attack') expect(action.targetId).toBe('p1')
  })
  test('范围内无敌人 → 向最近敌人移动', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 3, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia', position: { q: 0, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('射程为 1 的近战，距离 2 不触发攻击', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 2, r: 0 } }) // 距离 2
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('无更近的可达格 → 返回 move 或 endTurn（不死循环）', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 10, r: 10 } })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(['move', 'endTurn']).toContain(planEnemyAction(state(enemy, [foe])).type)
  })
})
