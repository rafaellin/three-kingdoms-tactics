import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { hexDistance } from '../hex/HexGrid'
import { createInitialState, type GameState, type HeroUnit } from './GameState'
import { gameReducer } from './reducer'
import { makeSetup } from '../testing/setup'
import { makePlainMap, key } from '../testing/maps'
import { isMine, RESOURCE_NODE_DEFS } from '../../data/resourceNode'

function makeStore(overrides: Partial<Parameters<typeof makeSetup>[0]> = {}): CommandLog<GameState> {
  const store = new CommandLog<GameState>(createInitialState(), gameReducer)
  store.dispatch('game/setup', makeSetup(overrides))
  return store
}

const fogOf = (s: GameState, hero: HeroUnit): Record<string, string> => s.visibility[hero.faction]

describe('game/setup 初始化英雄与视野', () => {
  test('hero 就位 (0,0)，移动力满，半径3地图全部已探索', () => {
    const s = makeStore().getState()
    expect(s.hero?.position).toEqual({ q: 0, r: 0 })
    expect(s.hero?.movementLeft).toBe(6)
    expect(s.hero?.sightRange).toBe(3)
    expect(Object.values(fogOf(s, s.hero as HeroUnit)).every((v) => v === 'explored')).toBe(true)
  })

  test('半径5地图：视野仅覆盖起点周围 3 格（37 已探索）', () => {
    const s = makeStore({ map: makePlainMap(5) }).getState()
    const fog = fogOf(s, s.hero as HeroUnit)
    const explored = Object.values(fog).filter((v) => v === 'explored').length
    expect(explored).toBe(37)
  })
})

describe('unit/move 单步移动', () => {
  test('移入可见可通行邻居：位置更新、移动力扣除、视野重算', () => {
    const store = makeStore({ map: makePlainMap(5) })
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    store.dispatch('unit/move', { to: { q: 2, r: 0 } })
    store.dispatch('unit/move', { to: { q: 3, r: 0 } })
    const s = store.getState()
    const hero = s.hero as HeroUnit
    expect(hero.position).toEqual({ q: 3, r: 0 })
    expect(hero.movementLeft).toBe(3) // 3 × 平地 1
    // 前方新格由未探索揭开，曾见格永久保持，远未见过仍黑
    const fog = fogOf(s, hero)
    expect(fog[key({ q: 4, r: 0 })]).toBe('explored') // 新揭开
    expect(fog[key({ q: 0, r: -2 })]).toBe('explored') // 曾见格永久保持
    expect(fog[key({ q: 0, r: 4 })]).toBe('unexplored') // 从未见过仍黑（distance((3,0),(0,4))=7 > 3）
    expect(hexDistance(hero.position, { q: 4, r: 0 })).toBe(1)
  })

  test('移入森林（代价 1.5）：移动力按小数扣除', () => {
    const store = makeStore({ map: makePlainMap(3, { [key({ q: 1, r: 0 })]: 'forest' }) })
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    const s = store.getState()
    expect(s.hero?.position).toEqual({ q: 1, r: 0 })
    expect(s.hero?.movementLeft).toBe(6 - 1.5)
  })

  test('非邻居被拒：距离 2 不能一步到达', () => {
    const store = makeStore()
    store.dispatch('unit/move', { to: { q: 2, r: 0 } })
    expect(store.getState().hero?.position).toEqual({ q: 0, r: 0 })
    expect(store.getState().hero?.movementLeft).toBe(6)
  })

  test('不可通行地形（山脉）被拒', () => {
    const store = makeStore({ map: makePlainMap(3, { [key({ q: 1, r: 0 })]: 'mountain' }) })
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    expect(store.getState().hero?.position).toEqual({ q: 0, r: 0 })
  })

  test('移动力不足被拒：连续走过沼泽消耗后无法再进', () => {
    // (1,0) 沼泽代价 2 × 3 次 = 6，第 4 次不合法
    const store = makeStore({ map: makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'swamp',
      [key({ q: 2, r: 0 })]: 'swamp',
      [key({ q: 3, r: 0 })]: 'swamp'
    }) })
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    store.dispatch('unit/move', { to: { q: 2, r: 0 } })
    store.dispatch('unit/move', { to: { q: 3, r: 0 } })
    const s = store.getState()
    expect(s.hero?.position).toEqual({ q: 3, r: 0 })
    expect(s.hero?.movementLeft).toBe(0)
    // 移动到 (4,0)：仍是邻居，但 movementLeft 0 < 沼泽 2 → 被拒
    store.dispatch('unit/move', { to: { q: 4, r: 0 } })
    expect(store.getState().hero?.position).toEqual({ q: 3, r: 0 })
  })

  test('未探索格被拒（防御性校验：fog 无记录时邻居也不可移动）', () => {
    const crafted: GameState = {
      ...createInitialState(),
      map: makePlainMap(3),
      hero: {
        generalId: 'g', faction: 'shu', position: { q: 0, r: 0 },
        movementLeft: 6, maxMovement: 6, sightRange: 3
      },
      visibility: { wei: {}, shu: {}, wu: {}, qun: {} }
    }
    const store = new CommandLog<GameState>(crafted, gameReducer)
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    expect(store.getState().hero?.position).toEqual({ q: 0, r: 0 })
  })

  test('已探索（explored）格可移入：永久可见即通行', () => {
    const crafted: GameState = {
      ...createInitialState(),
      map: makePlainMap(3),
      hero: {
        generalId: 'g', faction: 'shu', position: { q: 0, r: 0 },
        movementLeft: 6, maxMovement: 6, sightRange: 3
      },
      visibility: { wei: {}, shu: { [key({ q: 1, r: 0 })]: 'explored' }, wu: {}, qun: {} }
    }
    const store = new CommandLog<GameState>(crafted, gameReducer)
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    expect(store.getState().hero?.position).toEqual({ q: 1, r: 0 })
  })
})

describe('回合推进重置移动力', () => {
  test('轮回到英雄所属势力时移动力恢复满值', () => {
    const store = makeStore()
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    store.dispatch('unit/move', { to: { q: 2, r: 0 } })
    store.dispatch('unit/move', { to: { q: 3, r: 0 } })
    expect(store.getState().hero?.movementLeft).toBe(3)
    // wei → shu：轮到蜀，移动力重置
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.currentFaction).toBe('shu')
    expect(s.hero?.movementLeft).toBe(6)
  })
})

describe('unit/move 资源点拾取', () => {
  /** 构造带宝箱/木矿/石矿的平地地图 + setup */
  function makeNodeStore(): CommandLog<GameState> {
    const map = makePlainMap(5)
    map.nodes[key({ q: 1, r: 0 })] = 'chest'
    map.nodes[key({ q: 2, r: 0 })] = 'woodMine'
    map.nodes[key({ q: 3, r: 0 })] = 'stoneMine'
    return makeStore({ map })
  }

  test('setup 时初始化 nodeStates：地图上所有资源点进入状态表', () => {
    const s = makeNodeStore().getState()
    expect(s.nodeStates[key({ q: 1, r: 0 })]).toEqual({ owner: null, visited: false })
    expect(s.nodeStates[key({ q: 2, r: 0 })]).toEqual({ owner: null, visited: false })
    expect(s.nodeStates[key({ q: 3, r: 0 })]).toEqual({ owner: null, visited: false })
  })

  test('走入宝箱格：一次性拾取（+30金+5木），visited 置真，可重复进入但不重复拾取', () => {
    const store = makeNodeStore()
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    const s1 = store.getState()
    expect(s1.resources.shu?.gold).toBe(80 + 30)
    expect(s1.resources.shu?.wood).toBe(20 + 5)
    expect(s1.nodeStates[key({ q: 1, r: 0 })]?.visited).toBe(true)
    // 走出再回来：不重复拾取
    store.dispatch('unit/move', { to: { q: 0, r: 0 } })
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    const s2 = store.getState()
    expect(s2.resources.shu?.gold).toBe(80 + 30)
  })

  test('走入无主矿格：占领（owner=hero.faction）', () => {
    const store = makeNodeStore()
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    store.dispatch('unit/move', { to: { q: 2, r: 0 } })
    const s = store.getState()
    expect(s.nodeStates[key({ q: 2, r: 0 })]?.owner).toBe('shu')
    expect(s.nodeStates[key({ q: 2, r: 0 })]?.visited).toBe(false) // 矿非一次性，visited 语义不适用
  })

  test('移动进入已有主的矿：不夺占（战斗留后续）', () => {
    const map = makePlainMap(5)
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    const store = makeStore({ map })
    // 预置矿归魏
    const s0 = store.getState()
    s0.nodeStates[key({ q: 1, r: 0 })] = { owner: 'wei', visited: false }
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    expect(store.getState().nodeStates[key({ q: 1, r: 0 })]?.owner).toBe('wei')
  })

  test('矿产出类型由数据表决定（木矿 +2 木/天）', () => {
    expect(RESOURCE_NODE_DEFS.woodMine.dailyBonus?.wood).toBe(2)
    expect(isMine('woodMine')).toBe(true)
    expect(isMine('chest')).toBe(false)
  })
})
