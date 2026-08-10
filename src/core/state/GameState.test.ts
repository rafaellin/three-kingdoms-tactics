import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import {
  canAfford,
  createInitialState,
  deserializeState,
  serializeState,
  weekOf,
  type GameState,
  type Resources
} from './GameState'
import { gameReducer } from './reducer'
import { makeSetup } from '../testing/setup'

function makeStore(): CommandLog<GameState> {
  const store = new CommandLog<GameState>(createInitialState(), gameReducer)
  store.dispatch('game/setup', makeSetup())
  return store
}

const gold = (n: number): Resources => ({ gold: n, wood: 0, stone: 0, iron: 0 })

describe('game/setup', () => {
  test('建立初始状态：第 1 天、第一势力行动、资源/武将/城池/英雄/地图就位', () => {
    const s = makeStore().getState()
    expect(s.turn).toBe(1)
    expect(s.currentFaction).toBe('wei')
    expect(s.resources.wei).toEqual({ gold: 100, wood: 50, stone: 0, iron: 0 })
    expect(s.resources.shu).toEqual({ gold: 80, wood: 20, stone: 10, iron: 5 })
    expect(s.generals).toHaveLength(1)
    expect(s.generals[0]?.name).toBe('关羽')
    expect(s.towns).toHaveLength(1)
    expect(s.towns[0]?.owner).toBe('shu')
    expect(s.map?.hexes).toHaveLength(37)
    expect(s.hero?.position).toEqual({ q: 0, r: 0 })
    expect(s.hero?.movementLeft).toBe(6)
    expect(s.visibility.shu).not.toEqual({})
  })
})

describe('game/advanceTurn（回合推进）', () => {
  test('轮流到下一势力，同一天不变', () => {
    const store = makeStore()
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.currentFaction).toBe('shu')
    expect(s.turn).toBe(1)
  })

  test('四势力轮完一圈回到第一势力，天数 +1', () => {
    const store = makeStore()
    for (let i = 0; i < 4; i++) store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.currentFaction).toBe('wei')
    expect(s.turn).toBe(2)
  })

  test('空 turnOrder（未 setup）时不崩溃、状态不变', () => {
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    const before = store.getState()
    store.dispatch('game/advanceTurn')
    expect(store.getState()).toEqual(before)
  })
})

describe('周计算 weekOf', () => {
  test('第 1~7 天为第 1 周，8~14 为第 2 周', () => {
    expect(weekOf(1)).toBe(1)
    expect(weekOf(7)).toBe(1)
    expect(weekOf(8)).toBe(2)
    expect(weekOf(14)).toBe(2)
    expect(weekOf(15)).toBe(3)
  })
})

describe('economy 资源增扣', () => {
  test('add 增加指定势力资源', () => {
    const store = makeStore()
    store.dispatch('economy/add', { faction: 'wei', amount: gold(10) })
    expect(store.getState().resources.wei?.gold).toBe(110)
  })

  test('spend 资源足够时扣除', () => {
    const store = makeStore()
    store.dispatch('economy/spend', { faction: 'wei', cost: gold(10) })
    expect(store.getState().resources.wei?.gold).toBe(90)
  })

  test('spend 资源不足时状态不变（确定性 no-op）', () => {
    const store = makeStore()
    const before = store.getState()
    store.dispatch('economy/spend', { faction: 'wei', cost: gold(999) })
    expect(store.getState()).toEqual(before)
  })

  test('canAfford 判断是否可支付', () => {
    const s = makeStore().getState()
    expect(canAfford(s, 'wei', gold(100))).toBe(true)
    expect(canAfford(s, 'wei', gold(101))).toBe(false)
  })
})

describe('序列化（存档 / e2e 断言 / 回放）', () => {
  test('round-trip：序列化后反序列化得到相同状态', () => {
    const s = makeStore().getState()
    const revived = deserializeState(serializeState(s))
    expect(revived).toEqual(s)
    expect(serializeState(revived)).toBe(serializeState(s))
  })

  test('reducer 保持纯函数：命令序列重放 → 相同终态', () => {
    const store = makeStore()
    store.dispatch('game/advanceTurn')
    store.dispatch('economy/add', { faction: 'shu', amount: gold(5) })
    const final = store.getState()

    const replay = CommandLog.replay(createInitialState(), gameReducer, store.getLog())
    expect(replay).toEqual(final)
  })
})
