import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import {
  applyDailyIncome,
  computeDailyIncome,
  canAfford,
  createInitialState,
  currentHero,
  currentPlayer,
  deserializeState,
  serializeState,
  weekOf,
  type GameState,
  type Resources
} from './GameState'
import { aiAct, spawnNeutrals } from './ai'
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
  test('建立初始状态：第 1 天、首玩家行动、资源/武将/城池/英雄/地图就位', () => {
    const s = makeStore().getState()
    expect(s.turn).toBe(1)
    expect(s.players).toHaveLength(1)
    expect(s.players[0]).toEqual({ id: 'p1', faction: 'shu', kind: 'human' })
    expect(s.currentPlayerId).toBe('p1')
    expect(currentPlayer(s)?.id).toBe('p1')
    expect(s.resources.p1).toEqual({ gold: 80, wood: 20, stone: 10, iron: 5 })
    expect(s.generals).toHaveLength(1)
    expect(s.generals[0]?.name).toBe('關羽')
    expect(s.towns).toHaveLength(1)
    expect(s.towns[0]?.owner).toBe('p1')
    expect(s.map?.hexes).toHaveLength(37)
    expect(currentHero(s)?.position).toEqual({ q: 0, r: 0 })
    expect(currentHero(s)?.movementLeft).toBe(6)
    expect(currentHero(s)?.playerId).toBe('p1')
    expect(s.visibility.p1).not.toEqual({})
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

  test('currentPlayer：无 currentPlayerId 时回退 players[0]，无 players 返回 null', () => {
    const s = makeStore().getState()
    expect(currentPlayer({ ...s, currentPlayerId: null })?.id).toBe('p1')
    expect(currentPlayer({ ...s, currentPlayerId: 'g-nonexist' })?.id).toBe('p1')
    expect(currentPlayer(createInitialState())).toBeNull()
  })
})

describe('game/advanceTurn（回合推进：按玩家序列）', () => {
  test('单玩家：结束回合 → 天数 +1、行动力回满、currentPlayerId 仍为 p1', () => {
    const store = makeStore()
    // 先消耗移动力（走 2 步平地）
    store.dispatch('unit/move', { to: { q: 1, r: 0 } })
    store.dispatch('unit/move', { to: { q: 2, r: 0 } })
    expect(currentHero(store.getState())?.movementLeft).toBe(4)
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.currentPlayerId).toBe('p1')
    expect(s.turn).toBe(2)
    expect(currentHero(s)?.movementLeft).toBe(6)
  })

  test('单玩家连点 4 次结束回合 → 天数 +4', () => {
    const store = makeStore()
    for (let i = 0; i < 4; i++) store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.currentPlayerId).toBe('p1')
    expect(s.turn).toBe(5)
  })

  test('空 players（未 setup）时不崩溃、状态不变', () => {
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
  test('天数 +1：城池产金 + 矿产出到账（每天结算一次）', () => {
    // 单玩家：turn=7，p1 有成都（Lv1）+ 木矿 → 结束回合 → 天数 7→8，结算一次
    const map = makePlainMap(5)
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    const base = new CommandLog<GameState>(createInitialState(), gameReducer)
    base.dispatch('game/setup', makeSetup({ map }))
    const crafted: GameState = {
      ...base.getState(),
      turn: 7,
      nodeStates: {
        ...base.getState().nodeStates,
        [key({ q: 1, r: 0 })]: { owner: 'p1', visited: false }
      }
    }
    const store = new CommandLog<GameState>(crafted, gameReducer)
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.turn).toBe(8)
    expect(s.resources.p1?.gold).toBe((crafted.resources.p1?.gold ?? 0) + 10) // 成都 Lv1 ×10金/天
    expect(s.resources.p1?.wood).toBe((crafted.resources.p1?.wood ?? 0) + 2) // 木矿 +2木/天
  })

  test('每日结算按玩家循环：多玩家各自城池/矿收入独立到账（同势力不串）', () => {
    const map = makePlainMap(5)
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({
      map,
      // 同势力两个玩家（用户原则：同势力玩家资源各自独立，不串）
      players: [
        { id: 'p1', faction: 'shu', kind: 'human' },
        { id: 'p2', faction: 'shu', kind: 'human' }
      ],
      towns: [
        { id: 't1', name: '城1', owner: 'p1', level: 1, position: { q: 0, r: 0 }, garrisonGeneralId: null, garrison: [], visitorGeneralId: null },
        { id: 't2', name: '城2', owner: 'p2', level: 2, position: { q: 2, r: 0 }, garrisonGeneralId: null, garrison: [], visitorGeneralId: null }
      ]
    }))
    const s = store.getState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'p1', visited: false }
    const after = applyDailyIncome(s)
    // p1：成都 Lv1 +10金/天 + 木矿 +2木/天
    expect(after.resources.p1?.gold).toBe((s.resources.p1?.gold ?? 0) + 10)
    expect(after.resources.p1?.wood).toBe((s.resources.p1?.wood ?? 0) + 2)
    // p2（同势力蜀，资源独立）：城2 Lv2 +20金/天；不分享 p1 的木矿
    expect(after.resources.p2?.gold).toBe((s.resources.p2?.gold ?? 0) + 20)
    expect(after.resources.p2?.wood).toBe(s.resources.p2?.wood)
  })
})

describe('economy 资源增扣', () => {
  test('add 增加指定玩家资源', () => {
    const store = makeStore()
    store.dispatch('economy/add', { playerId: 'p1', amount: gold(10) })
    expect(store.getState().resources.p1?.gold).toBe(90)
  })

  test('spend 资源足够时扣除', () => {
    const store = makeStore()
    store.dispatch('economy/spend', { playerId: 'p1', cost: gold(10) })
    expect(store.getState().resources.p1?.gold).toBe(70)
  })

  test('spend 资源不足时状态不变（确定性 no-op）', () => {
    const store = makeStore()
    const before = store.getState()
    store.dispatch('economy/spend', { playerId: 'p1', cost: gold(999) })
    expect(store.getState()).toEqual(before)
  })

  test('canAfford 判断是否可支付', () => {
    const s = makeStore().getState()
    expect(canAfford(s, 'p1', gold(80))).toBe(true)
    expect(canAfford(s, 'p1', gold(81))).toBe(false)
    expect(canAfford(s, 'ai1', gold(1))).toBe(false) // 非对局玩家无资源
  })
})

describe('computeDailyIncome（每日产出汇总，供 HUD 显示 (+N)）', () => {
  /** 带两座矿（木矿→p1、石矿→p2）+ 成都（p1，Lv1）的地图 */
  function makeMineState(): GameState {
    const map = makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'plain',
      [key({ q: 2, r: 0 })]: 'plain'
    })
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    map.nodes[key({ q: 2, r: 0 })] = 'stoneMine'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({
      map,
      players: [
        { id: 'p1', faction: 'shu', kind: 'human' },
        { id: 'p2', faction: 'shu', kind: 'human' }
      ]
    }))
    const s = store.getState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'p1', visited: false }
    s.nodeStates[key({ q: 2, r: 0 })] = { owner: 'p2', visited: false }
    return s
  }

  test('按玩家汇总：城池产金 + 已占矿产出，未占资源为 0', () => {
    const s = makeMineState()
    // p1：成都 Lv1 → +10金/天；木矿 → +2木/天
    expect(computeDailyIncome(s, 'p1')).toEqual({ gold: 10, wood: 2, stone: 0, iron: 0 })
    // p2（同势力蜀）：无城；石矿 → +1石/天（各自独立）
    expect(computeDailyIncome(s, 'p2')).toEqual({ gold: 0, wood: 0, stone: 1, iron: 0 })
  })

  test('无主矿不计入产出', () => {
    const s = makeMineState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: null, visited: false }
    expect(computeDailyIncome(s, 'p1')).toEqual({ gold: 10, wood: 0, stone: 0, iron: 0 })
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
    expect(computeDailyIncome(s, 'p1')).toEqual({ gold: 10, wood: 0, stone: 0, iron: 0 })
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
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'p1', visited: false }
    s.nodeStates[key({ q: 2, r: 0 })] = { owner: 'p1', visited: false }
    expect(computeDailyIncome(s, 'p1')).toEqual({ gold: 10, wood: 4, stone: 0, iron: 0 })
  })
})

describe('applyDailyIncome（每日结算）', () => {
  /** 带两座矿（木矿→p1、石矿→p2）+ 成都（p1，Lv1）的地图 */
  function makeMineState(): GameState {
    const map = makePlainMap(3, {
      [key({ q: 1, r: 0 })]: 'plain',
      [key({ q: 2, r: 0 })]: 'plain'
    })
    map.nodes[key({ q: 1, r: 0 })] = 'woodMine'
    map.nodes[key({ q: 2, r: 0 })] = 'stoneMine'
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup({
      map,
      players: [
        { id: 'p1', faction: 'shu', kind: 'human' },
        { id: 'p2', faction: 'shu', kind: 'human' }
      ]
    }))
    const s = store.getState()
    // 标记两座矿分别被 p1/p2 占领
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: 'p1', visited: false }
    s.nodeStates[key({ q: 2, r: 0 })] = { owner: 'p2', visited: false }
    return s
  }

  test('城池收入：内政厅等级 ×10 金/天 给所属玩家', () => {
    const s = makeMineState()
    const after = applyDailyIncome(s)
    // 成都 Lv1 → p1 +10 金；p2 无城
    expect(after.resources.p1?.gold).toBe((s.resources.p1?.gold ?? 0) + 10)
    expect(after.resources.p2?.gold).toBe(s.resources.p2?.gold)
  })

  test('矿产出：木矿+2木/天 / 石矿+1石/天 给占领方', () => {
    const s = makeMineState()
    const after = applyDailyIncome(s)
    expect(after.resources.p1?.wood).toBe((s.resources.p1?.wood ?? 0) + 2)
    expect(after.resources.p2?.stone).toBe((s.resources.p2?.stone ?? 0) + 1)
    // 其他资源不变
    expect(after.resources.p1?.gold).toBe((s.resources.p1?.gold ?? 0) + 10)
    expect(after.resources.p1?.iron).toBe(s.resources.p1?.iron)
  })

  test('无主矿不产出', () => {
    const s = makeMineState()
    s.nodeStates[key({ q: 1, r: 0 })] = { owner: null, visited: false }
    const after = applyDailyIncome(s)
    expect(after.resources.p1?.wood).toBe(s.resources.p1?.wood)
    expect(after.resources.p1?.gold).toBe((s.resources.p1?.gold ?? 0) + 10)
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

describe('aiAct / spawnNeutrals（接口占位，MVP no-op）', () => {
  test('aiAct 返回原 state（AI 配置「不动」→ 无行动）', () => {
    const s = makeStore().getState()
    expect(aiAct(s, 'ai1')).toBe(s)
  })

  test('spawnNeutrals 返回原 state（无随机野怪生成）', () => {
    const s = makeStore().getState()
    expect(spawnNeutrals(s)).toBe(s)
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
    store.dispatch('economy/add', { playerId: 'p1', amount: gold(5) })
    const final = store.getState()

    const replay = CommandLog.replay(createInitialState(), gameReducer, store.getLog())
    expect(replay).toEqual(final)
  })
})
