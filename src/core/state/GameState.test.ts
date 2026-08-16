import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import {
  applyDailyIncome,
  computeDailyIncome,
  canAfford,
  createInitialState,
  currentHero,
  deserializeState,
  serializeState,
  weekOf,
  type GameState,
  type Resources
} from './GameState'
import { gameReducer } from './reducer'
import { deriveStats } from '../generals'
import { GENERAL_BASES } from '../../data/generals'
import { MAX_LEVEL } from '../growth'
import { makeSetup } from '../testing/setup'
import { makePlainMap, key } from '../testing/maps'

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
    expect(currentHero(s)?.position).toEqual({ q: 0, r: 0 })
    expect(currentHero(s)?.movementLeft).toBe(6)
    expect(s.visibility.shu).not.toEqual({})
  })

  test('多英雄：GameState.heroes 存在，general 带 army，town 带双槽', () => {
    const s = makeStore().getState()
    expect(s.heroes).toHaveLength(1)
    expect(s.selectedHeroId).toBe('g-guan')
    expect(s.generals[0]?.army).toBeDefined()
    expect(s.towns[0]?.garrison).toBeDefined()
    expect(s.towns[0]?.visitorGeneralId).toBeNull()
  })

  test('currentHero：返回选中英雄，无选中回退数组第一个，无英雄返回 null', () => {
    // setup 后 selectedHeroId = 第一个英雄
    const s = makeStore().getState()
    expect(currentHero(s)?.generalId).toBe('g-guan')
    // 无选中 → 回退 heroes[0]
    const s2 = makeStore().getState()
    expect(currentHero({ ...s2, selectedHeroId: null })?.generalId).toBe('g-guan')
    // 选中 id 找不到 → 回退 heroes[0]
    expect(currentHero({ ...s2, selectedHeroId: 'g-nonexist' })?.generalId).toBe('g-guan')
    // 空英雄 → null
    expect(currentHero(createInitialState())).toBeNull()
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

describe('game/advanceTurn 每日结算', () => {
  test('天数 +1（圈回第一势力）：城池产金 + 矿产出到账（每天结算一次）', () => {
    // 手工构造：turn=7，蜀有成都（Lv1）+ 木矿，从魏开始推一圈回到魏（天数 +1）
    const map = makePlainMap(5)
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    const base = new CommandLog<GameState>(createInitialState(), gameReducer)
    base.dispatch('game/setup', makeSetup({ map }))
    const crafted: GameState = {
      ...base.getState(),
      turn: 7,
      currentFaction: 'wei',
      nodeStates: {
        ...base.getState().nodeStates,
        [key({ q: 1, r: 0 })]: { owner: 'shu', visited: false }
      }
    }
    const store = new CommandLog<GameState>(crafted, gameReducer)
    // wei → shu → wu → qun → wei 一圈回来 turn 7→8，天数 +1 → 每日结算
    for (let i = 0; i < 4; i++) store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.turn).toBe(8)
    expect(s.resources.shu?.gold).toBe((crafted.resources.shu?.gold ?? 0) + 10) // 成都 Lv1 ×10金/天
    expect(s.resources.shu?.wood).toBe((crafted.resources.shu?.wood ?? 0) + 2) // 木矿 +2木/天
  })

  test('同一天内轮换（天数未变）不触发结算', () => {
    const base = new CommandLog<GameState>(createInitialState(), gameReducer)
    base.dispatch('game/setup', makeSetup())
    const crafted: GameState = { ...base.getState(), turn: 6, currentFaction: 'wei' }
    const store = new CommandLog<GameState>(crafted, gameReducer)
    const before = store.getState().resources
    // wei→shu→wu→qun：3 次推进，天数仍为 6，不结算
    for (let i = 0; i < 3; i++) store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.turn).toBe(6)
    expect(s.resources).toEqual(before)
    // 第 4 次推进（qun→wei）天数 6→7，结算一次
    store.dispatch('game/advanceTurn')
    expect(store.getState().turn).toBe(7)
    expect(store.getState().resources.shu?.gold).toBe((before.shu?.gold ?? 0) + 10)
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

describe('computeDailyIncome（每日产出汇总，供 HUD 显示 (+N)）', () => {
  /** 带两座矿（木矿→蜀、石矿→魏）+ 成都（蜀，Lv1）的地图 */
  function makeMineState(): GameState {
    const map = makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'plain',
      [key({ q: 2, r: 0 })]: 'plain'
    })
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    map.nodes[key({ q: 2, r: 0 })] = 'stoneMine'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({ map }))
    const s = store.getState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'shu', visited: false }
    s.nodeStates[key({ q: 2, r: 0 })] = { owner: 'wei', visited: false }
    return s
  }

  test('按势力汇总：城池产金 + 已占矿产出，未占资源为 0', () => {
    const s = makeMineState()
    // 蜀：成都 Lv1 → +10金/天；木矿 → +2木/天
    expect(computeDailyIncome(s, 'shu')).toEqual({ gold: 10, wood: 2, stone: 0, iron: 0 })
    // 魏：无城；石矿 → +1石/天
    expect(computeDailyIncome(s, 'wei')).toEqual({ gold: 0, wood: 0, stone: 1, iron: 0 })
    // 吴：无城无矿
    expect(computeDailyIncome(s, 'wu')).toEqual({ gold: 0, wood: 0, stone: 0, iron: 0 })
  })

  test('无主矿不计入产出', () => {
    const s = makeMineState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: null, visited: false }
    expect(computeDailyIncome(s, 'shu')).toEqual({ gold: 10, wood: 0, stone: 0, iron: 0 })
  })

  test('宝箱（一次性）不计入每日产出', () => {
    const map = makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'plain'
    })
    map.nodes[key({ q: 1, r: 0 })] = 'chest'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({ map }))
    const s = store.getState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: null, visited: true }
    expect(computeDailyIncome(s, 'shu')).toEqual({ gold: 10, wood: 0, stone: 0, iron: 0 })
  })

  test('多座同资源矿产出累加', () => {
    const map = makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'plain',
      [key({ q: 2, r: 0 })]: 'plain'
    })
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    map.nodes[key({ q: 2, r: 0 })] = 'woodMine'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({ map }))
    const s = store.getState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'shu', visited: false }
    s.nodeStates[key({ q: 2, r: 0 })] = { owner: 'shu', visited: false }
    expect(computeDailyIncome(s, 'shu')).toEqual({ gold: 10, wood: 4, stone: 0, iron: 0 })
  })
})

describe('applyDailyIncome（每日结算）', () => {
  /** 带两座矿（木矿→蜀、石矿→魏）+ 成都（蜀，Lv1）的地图 */
  function makeMineState(): GameState {
    const map = makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'plain',
      [key({ q: 2, r: 0 })]: 'plain'
    })
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    map.nodes[key({ q: 2, r: 0 })] = 'stoneMine'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({ map }))
    const s = store.getState()
    // 标记两座矿分别被蜀/魏占领
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'shu', visited: false }
    s.nodeStates[key({ q: 2, r: 0 })] = { owner: 'wei', visited: false }
    return s
  }

  test('城池收入：内政厅等级 ×10 金/天 给所属势力', () => {
    const s = makeMineState()
    const after = applyDailyIncome(s)
    // 成都 Lv1 → shu +10 金；魏无城
    expect(after.resources.shu?.gold).toBe(s.resources.shu?.gold + 10)
    expect(after.resources.wei?.gold).toBe(s.resources.wei?.gold)
  })

  test('矿产出：木矿+2木/天 / 石矿+1石/天 给占领方', () => {
    const s = makeMineState()
    const after = applyDailyIncome(s)
    expect(after.resources.shu?.wood).toBe((s.resources.shu?.wood ?? 0) + 2)
    expect(after.resources.wei?.stone).toBe((s.resources.wei?.stone ?? 0) + 1)
    // 其他资源不变
    expect(after.resources.shu?.gold).toBe((s.resources.shu?.gold ?? 0) + 10)
    expect(after.resources.shu?.iron).toBe(s.resources.shu?.iron)
  })

  test('无主矿不产出', () => {
    const s = makeMineState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: null, visited: false }
    const after = applyDailyIncome(s)
    expect(after.resources.shu?.wood).toBe(s.resources.shu?.wood)
    expect(after.resources.shu?.gold).toBe((s.resources.shu?.gold ?? 0) + 10)
  })

  test('宝箱非矿，每日结算不计产出', () => {
    const map = makePlainMap(3)
    map.nodes[key({ q: 1, r: 0 })] = 'chest'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    // 无城（towns: []），仅一宝箱 → 结算应无变化
    store.dispatch('game/setup', makeSetup({ map, towns: [] }))
    const s = store.getState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: null, visited: true }
    const after = applyDailyIncome(s)
    expect(after).toEqual(s) // 无城无矿 → 结算无变化
  })
})

describe('general/gainXp（武将经验与升级）', () => {
  const GUAN = GENERAL_BASES['g-guan']

  test('加经验不升级：xp 累加、level/属性不变', () => {
    const store = makeStore()
    const before = store.getState().generals[0]!
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 500 })
    const g = store.getState().generals[0]!
    expect(g.xp).toBe(500)
    expect(g.level).toBe(1)
    expect(g.stats).toEqual(before.stats)
  })

  test('单级升级：扣 xpToNext 清余、重算属性、skillSlots 更新', () => {
    const store = makeStore()
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 1200 }) // xpToNext(1)=1000 → 余 200
    const g = store.getState().generals[0]!
    expect(g.level).toBe(2)
    expect(g.xp).toBe(200)
    expect(g.skillSlots).toBe(0) // floor(2/3)
    expect(g.stats).toEqual(deriveStats(GUAN, 2))
  })

  test('连升：一次加大量跨多级（8000 → Lv6，余 558）', () => {
    const store = makeStore()
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 8000 })
    const g = store.getState().generals[0]!
    expect(g.level).toBe(6)
    expect(g.xp).toBe(558)
    expect(g.skillSlots).toBe(2) // floor(6/3)
    expect(g.stats).toEqual(deriveStats(GUAN, 6))
  })

  test('3 级解锁技能槽：Lv3→1、Lv6→2', () => {
    const store = makeStore()
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 1000 }) // → Lv2，余 0
    expect(store.getState().generals[0]!.skillSlots).toBe(0) // floor(2/3)
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 1200 }) // → Lv3，余 0
    expect(store.getState().generals[0]!.skillSlots).toBe(1) // floor(3/3)
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 1440 + 1728 + 2074 }) // → Lv6
    expect(store.getState().generals[0]!.skillSlots).toBe(2) // floor(6/3)
  })

  test('达到 MAX_LEVEL 停止：level 不变、xp 不再扣', () => {
    const base = makeStore().getState()
    const crafted: GameState = {
      ...base,
      generals: [
        {
          ...base.generals[0]!,
          level: MAX_LEVEL,
          xp: 0,
          stats: deriveStats(GUAN, MAX_LEVEL),
          skillSlots: Math.floor(MAX_LEVEL / 3)
        }
      ]
    }
    const store = new CommandLog<GameState>(crafted, gameReducer)
    store.dispatch('general/gainXp', { generalId: 'g-guan', amount: 999999 })
    const g = store.getState().generals[0]!
    expect(g.level).toBe(MAX_LEVEL)
    expect(g.xp).toBe(999999) // 到顶不再扣经验、不再升级
  })

  test('找不到武将 → no-op 返回原 state', () => {
    const store = makeStore()
    const before = store.getState()
    store.dispatch('general/gainXp', { generalId: 'g-nonexist', amount: 500 })
    expect(store.getState()).toEqual(before)
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
