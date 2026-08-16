/**
 * 战役命令集测试：campaign/start · hero/select · hero/move（守将/杂兵终点放行 + 重叠阻挡）·
 * 城池交互（enterTown/garrison/leaveTown/swapHeroes/transferTroops）·
 * 战斗回流（resolveBattle → 胜利占格/失败回城 + 守将 alive=false + 经验 + checkVictory）·
 * MapMovementCost 武将格不可通行。
 * 全部走确定性 reducer（CommandLog 折叠），无浏览器依赖。
 */
import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { hexKey } from '../hex/HexGrid'
import { MapMovementCost } from '../pathfinding/MapMovementCost'
import { createInitialState, type GameState } from './GameState'
import { gameReducer } from './reducer'
import { makeSetup } from '../testing/setup'
import { CAMPAIGNS } from '../../data/campaigns'

/** 用东岭关战役配置启动 CommandLog（campaign/start） */
function makeCampaignStore(mode: 'campaign' | 'explore' = 'campaign'): CommandLog<GameState> {
  const store = new CommandLog<GameState>(createInitialState(), gameReducer)
  store.dispatch('campaign/start', { mode, campaign: CAMPAIGNS.dongling })
  return store
}

describe('campaign/start 战役启动', () => {
  test('campaign 模式：放守将+胜利条件；explore 不放守将', () => {
    const c = makeCampaignStore('campaign').getState()
    expect(c.campaignId).toBe('dongling')
    expect(c.players).toHaveLength(2)
    expect(c.players[0]).toEqual({ id: 'p1', faction: 'shu', kind: 'human' })
    expect(c.players[1]).toEqual({ id: 'ai1', faction: 'wei', kind: 'ai' })
    expect(c.currentPlayerId).toBe('p1')
    expect(c.garrisons).toHaveLength(1)
    expect(c.garrisons[0]!.id).toBe('gar-kongxiu')
    expect(c.garrisons[0]!.alive).toBe(true)
    expect(c.victory?.kind).toBe('defeatGarrison')
    expect(c.heroes).toHaveLength(3)
    expect(c.selectedHeroId).toBe('g-guan')
    expect(c.heroes[0]!.faction).toBe('shu')
    expect(c.heroes[0]!.playerId).toBe('p1')
    expect(c.outcome).toBeNull()

    const e = makeCampaignStore('explore').getState()
    expect(e.garrisons).toHaveLength(0)
    expect(e.victory).toBeNull()
    expect(e.heroes).toHaveLength(3)
    // 探索模式 = 单人（Spec §3）：players 只保留 human [p1]，AI 不参与回合轮转
    expect(e.players).toEqual([{ id: 'p1', faction: 'shu', kind: 'human' }])
    expect(e.currentPlayerId).toBe('p1')
  })

  test('campaign/start 深拷贝：修改状态不改动共享战役配置', () => {
    const store = makeCampaignStore()
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    const s = store.getState()
    // 关羽移动了位置，但战役配置里的英雄初始位置不受影响
    expect(CAMPAIGNS.dongling.heroStarts.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: -1 })
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 0 })
    expect(s.garrisons[0]!.alive).toBe(true)
  })
})

describe('hero/select 选中英雄', () => {
  test('切换选中；无效 id 不变；null 清空', () => {
    const store = makeCampaignStore()
    expect(store.getState().selectedHeroId).toBe('g-guan')
    store.dispatch('hero/select', { heroId: 'g-sunqian' })
    expect(store.getState().selectedHeroId).toBe('g-sunqian')
    store.dispatch('hero/select', { heroId: 'g-nonexist' })
    expect(store.getState().selectedHeroId).toBe('g-sunqian')
    store.dispatch('hero/select', { heroId: null })
    expect(store.getState().selectedHeroId).toBeNull()
  })
})

describe('game/advanceTurn 多英雄回合', () => {
  test('轮到 p1 时 ALL p1 英雄移动力全恢复（不只选中英雄）', () => {
    const store = makeCampaignStore()
    // 关羽 (0,-1)→(0,0)、周仓 (-1,-1)→(-1,0)：各耗 1 点移动力（平地）
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    let s = store.getState()
    expect(s.currentPlayerId).toBe('p1') // 战役初始当前玩家 = players[0]
    expect(s.heroes.find((h) => h.generalId === 'g-guan')!.movementLeft).toBe(5)
    expect(s.heroes.find((h) => h.generalId === 'g-zhoucang')!.movementLeft).toBe(5)
    // 结束回合：p1 → ai1（AI 自动行动 no-op）→ 回 p1（system 天数+1）→ 所有 p1 英雄移动力恢复满
    store.dispatch('game/advanceTurn')
    s = store.getState()
    expect(s.currentPlayerId).toBe('p1')
    for (const gid of ['g-guan', 'g-zhoucang', 'g-sunqian']) {
      expect(s.heroes.find((h) => h.generalId === gid)!.movementLeft).toBe(6)
    }
  })

  test('玩家 → AI → system：单次结束回合即推进一天（AI 不占回合）', () => {
    const store = makeCampaignStore()
    expect(store.getState().turn).toBe(1)
    store.dispatch('game/advanceTurn')
    expect(store.getState().turn).toBe(2)
    expect(store.getState().currentPlayerId).toBe('p1')
  })
})

describe('game/advanceTurn 探索模式 + system 结算', () => {
  test('探索模式结束回合：回 p1 + 天数+1 + 行动力回满（结束回合 = 下一天 + 回满）', () => {
    const store = makeCampaignStore('explore')
    // 关羽 (0,-1)→(0,0) 耗 1 点移动力（平地；探索模式不放守将，可达）
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    let s = store.getState()
    expect(s.currentPlayerId).toBe('p1')
    expect(s.turn).toBe(1)
    expect(s.heroes.find((h) => h.generalId === 'g-guan')!.movementLeft).toBe(5)
    // 结束回合 → 回 p1（campaign/start 探索模式 = 单玩家 [p1]，Spec §3；一圈即跨圈进 system）
    // + 下一天 + ALL 英雄行动力回满（与下方「单玩家」路径一致）
    store.dispatch('game/advanceTurn')
    s = store.getState()
    expect(s.currentPlayerId).toBe('p1')
    expect(s.turn).toBe(2)
    for (const gid of ['g-guan', 'g-zhoucang', 'g-sunqian']) {
      expect(s.heroes.find((h) => h.generalId === gid)!.movementLeft).toBe(6)
    }
  })

  test('system 结算：结束回合跨圈 → 天数+1 + 城池每日产金到账（applyDailyIncome）', () => {
    const store = makeCampaignStore()
    // p1 初始金 80（START_RESOURCES）；东岭城 t-dongling Lv1 归 p1 → +10金/天
    expect(store.getState().resources.p1!.gold).toBe(80)
    // 战役：p1 → ai1（AI 自动行动 no-op）→ 回 p1 跨圈 → system 结算
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.resources.p1!.gold).toBe(90) // 80 + 城池日收 10
  })

  test('单玩家（players=[p1]）结束回合：p1 → 直接 system → 回 p1，天数+1 + 行动力回满', () => {
    // 探索测试单玩家路径：game/setup 用 START_PLAYERS=[p1]（不含 AI）
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/setup', makeSetup())
    expect(store.getState().players).toHaveLength(1)
    expect(store.getState().currentPlayerId).toBe('p1')
    store.dispatch('unit/move', { to: { q: 1, r: 0 } }) // 平地耗 1 移动力
    expect(store.getState().heroes[0]!.movementLeft).toBe(5)
    // 结束回合：单玩家一圈即回起点 → system 结算（天数+1 + 行动力回满）
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.currentPlayerId).toBe('p1')
    expect(s.turn).toBe(2)
    expect(s.heroes[0]!.movementLeft).toBe(6)
  })

  test('players 为空（初始态）→ advanceTurn 原样返回（不崩溃）', () => {
    const store = new CommandLog<GameState>(createInitialState(), gameReducer)
    store.dispatch('game/advanceTurn')
    const s = store.getState()
    expect(s.players).toHaveLength(0)
    expect(s.currentPlayerId).toBeNull()
    expect(s.turn).toBe(1)
  })
})

describe('hero/move 英雄移动（守将/杂兵终点放行 + 重叠阻挡）', () => {
  test('目标格是存活守将格 → 可作为移动终点（走进触发战斗，问题5 修订）', () => {
    const store = makeCampaignStore()
    // 关羽在 (0,-1)，走到 (0,0) 后再走进 (0,1)（孔秀格）——守将格作为移动终点放行
    store.dispatch('hero/select', { heroId: 'g-guan' })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 1 } })
    const s = store.getState()
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 1 }) // 走进守将格
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.movementLeft).toBe(4) // 两格平地各扣 1
    expect(s.garrisons[0]!.alive).toBe(true) // 守将状态由渲染层战斗触发结算，reducer 只放行走入
  })

  test('目标格是未歼灭杂兵格 → 可作为移动终点（走进触发战斗）', () => {
    const store = makeCampaignStore()
    // 关羽 (0,-1) 直接走进杂兵 neu-1 (0,-2)（相邻）
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: -2 } })
    const s = store.getState()
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: -2 })
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.movementLeft).toBe(5) // 平地扣 1
    expect(s.neutrals.find((n) => n.id === 'neu-1')!.defeated).toBe(false) // 杂兵状态由战斗结算处理
  })

  test('守将阵亡后 → 可通行', () => {
    const store = makeCampaignStore()
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'won', remainingTroops: [{ defId: 'swordsman', count: 12 }], expGained: 0 },
      garrisonId: 'gar-kongxiu',
      heroId: 'g-guan'
    })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 1 } })
    expect(store.getState().heroes.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 1 })
  })

  test('目标格被其他英雄占据 → 拒绝（含己方英雄，问题2）', () => {
    const store = makeCampaignStore()
    // 周仓 (-1,-1)→(-1,0)→(0,0) 抢占城格；关羽 (0,-1) 想走进 (0,0)（周仓占据）→ 拒绝
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    const s = store.getState()
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: -1 })
    expect(s.heroes.find((h) => h.generalId === 'g-zhoucang')?.position).toEqual({ q: 0, r: 0 })
  })
})

describe('campaign/resolveBattle 战斗回流', () => {
  test('击败守将 → 写回 army + 经验 + alive=false + checkVictory → outcome=won', () => {
    const store = makeCampaignStore()
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'won', remainingTroops: [{ defId: 'swordsman', count: 12 }], expGained: 500 },
      garrisonId: 'gar-kongxiu',
      heroId: 'g-guan'
    })
    const s = store.getState()
    expect(s.garrisons[0]!.alive).toBe(false)
    expect(s.outcome).toBe('won')
    const guan = s.generals.find((g) => g.id === 'g-guan')!
    expect(guan.army).toEqual([{ defId: 'swordsman', count: 12 }])
    expect(guan.xp).toBe(500) // Lv5，xpToNext(5)=2074，500 不足升级
    expect(guan.level).toBe(5)
  })

  test('胜利 → 英雄占目标格（position=targetPosition）、不清空剩余移动力', () => {
    const store = makeCampaignStore()
    // 关羽 (0,-1)→(0,0)→(0,1) 走进孔秀格（两格平地 → 移动力 4）
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 1 } })
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'won', remainingTroops: [{ defId: 'swordsman', count: 12 }], expGained: 0 },
      garrisonId: 'gar-kongxiu',
      heroId: 'g-guan',
      playerId: 'p1',
      targetPosition: { q: 0, r: 1 }
    })
    const s = store.getState()
    expect(s.heroes.find((h) => h.generalId === 'g-guan')!.position).toEqual({ q: 0, r: 1 }) // 胜利占格
    expect(s.heroes.find((h) => h.generalId === 'g-guan')!.movementLeft).toBe(4) // 不清空剩余移动力
    expect(s.garrisons[0]!.alive).toBe(false)
    expect(s.outcome).toBe('won')
  })

  test('战败 → 英雄回最近己方城（玩家第一城格）、行动力 = 0', () => {
    const store = makeCampaignStore()
    // 关羽走进孔秀格 (0,1) 后战败 → 回东岭小城 (0,0)
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 1 } })
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'lost', remainingTroops: [{ defId: 'militia', count: 3 }], expGained: 0 },
      garrisonId: 'gar-kongxiu',
      heroId: 'g-guan',
      playerId: 'p1',
      targetPosition: { q: 0, r: 1 }
    })
    const s = store.getState()
    expect(s.heroes.find((h) => h.generalId === 'g-guan')!.position).toEqual({ q: 0, r: 0 }) // 回城格
    expect(s.heroes.find((h) => h.generalId === 'g-guan')!.movementLeft).toBe(0) // 行动力清零
    expect(s.garrisons[0]!.alive).toBe(true) // 战败守将仍存活
    expect(s.outcome).toBeNull()
    expect(s.generals.find((g) => g.id === 'g-guan')!.army).toEqual([{ defId: 'militia', count: 3 }])
  })

  test('战败 → 守将仍存活、不获胜，army 仍写回', () => {
    const store = makeCampaignStore()
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'lost', remainingTroops: [{ defId: 'militia', count: 3 }], expGained: 0 },
      garrisonId: 'gar-kongxiu',
      heroId: 'g-guan'
    })
    const s = store.getState()
    expect(s.garrisons[0]!.alive).toBe(true)
    expect(s.outcome).toBeNull()
    expect(s.generals.find((g) => g.id === 'g-guan')!.army).toEqual([{ defId: 'militia', count: 3 }])
  })

  test('击败中立杂兵 → defeated=true；不打到胜利条件不获胜', () => {
    const store = makeCampaignStore()
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'won', remainingTroops: [], expGained: 200 },
      neutralId: 'neu-1',
      heroId: 'g-zhoucang'
    })
    const s = store.getState()
    expect(s.neutrals.find((n) => n.id === 'neu-1')!.defeated).toBe(true)
    expect(s.garrisons[0]!.alive).toBe(true) // 孔秀未败
    expect(s.outcome).toBeNull()
  })
})

describe('campaign/checkVictory 胜利检查', () => {
  test('守将未死 → 不获胜；目标守将死 → won', () => {
    const store = makeCampaignStore()
    store.dispatch('campaign/checkVictory')
    expect(store.getState().outcome).toBeNull()
    store.dispatch('campaign/resolveBattle', {
      result: { outcome: 'won', remainingTroops: [], expGained: 0 },
      garrisonId: 'gar-kongxiu',
      heroId: 'g-guan'
    })
    expect(store.getState().outcome).toBe('won')
  })
})

describe('城池交互', () => {
  test('进城 → 驻守 → 移兵 → 出城 完整流转', () => {
    const store = makeCampaignStore()
    // 孙乾进城：访问武将保留在 heroes（位置=城格，大地图叠城上可见）
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    let s = store.getState()
    expect(s.towns[0]!.visitorGeneralId).toBe('g-sunqian')
    const visiting = s.heroes.find((h) => h.generalId === 'g-sunqian')!
    expect(visiting.position).toEqual({ q: 0, r: 0 }) // 访问武将仍在地图上（叠城上）
    // 驻守：访问→驻城，英雄从 heroes 移除（进 garrison，大地图不可见）
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-sunqian')
    expect(s.towns[0]!.visitorGeneralId).toBeNull()
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')).toBeUndefined() // 驻城后从 heroes 移除
    // 移兵进城（英雄 army → 城 garrison）
    store.dispatch('town/transferTroops', { townId: 't-dongling', from: 'hero', defId: 'militia', count: 5 })
    s = store.getState()
    expect(s.towns[0]!.garrison).toEqual([{ defId: 'militia', count: 5 }])
    const sunqian = s.generals.find((g) => g.id === 'g-sunqian')!
    expect(sunqian.army.find((u) => u.defId === 'militia')!.count).toBe(10) // 15 - 5
    // 出城（驻城英雄）→ 回 heroes，位置=城格、满移动力
    store.dispatch('hero/leaveTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBeNull()
    const back = s.heroes.find((h) => h.generalId === 'g-sunqian')!
    expect(back.position).toEqual({ q: 0, r: 0 })
    expect(back.movementLeft).toBe(6)
    expect(back.faction).toBe('shu')
    expect(back.playerId).toBe('p1') // 出城英雄归属城主玩家
  })

  test('leaveTown：访问武将出城 → 仅清访问槽，英雄仍在地图上（不重复添加）', () => {
    const store = makeCampaignStore()
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('hero/leaveTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    const s = store.getState()
    expect(s.towns[0]!.visitorGeneralId).toBeNull()
    expect(s.towns[0]!.garrisonGeneralId).toBeNull()
    const hero = s.heroes.find((h) => h.generalId === 'g-sunqian')!
    expect(hero.position).toEqual({ q: 0, r: 0 }) // 访问者本就在 heroes，出城后仍在城格
    expect(s.heroes.filter((h) => h.generalId === 'g-sunqian')).toHaveLength(1) // 未重复添加
  })

  test('moveHeroTo：访问武将离开城格 → 清空访问槽（离开即结束访问）', () => {
    const store = makeCampaignStore()
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    expect(store.getState().towns[0]!.visitorGeneralId).toBe('g-sunqian')
    // 访问武将沿城格向左移动离开城 → 访问结束
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: -1, r: 0 } })
    const s = store.getState()
    expect(s.towns[0]!.visitorGeneralId).toBeNull()
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')!.position).toEqual({ q: -1, r: 0 })
  })

  test('enterTown：访问槽被占时拒绝第二英雄进城（不覆盖丢失武将）', () => {
    const store = makeCampaignStore()
    // 孙乾进城成为访问武将（仍在 heroes，位置=城格 → 城格被占用）
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    // 周仓试图走上城格 → 被重叠守卫拒绝（孙乾站在城格上，不能叠城）；enterTown 也因不在城格拒绝
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-zhoucang', townId: 't-dongling' })
    const s = store.getState()
    expect(s.towns[0]!.visitorGeneralId).toBe('g-sunqian') // 原访问武将未被覆盖
    expect(s.heroes.find((h) => h.generalId === 'g-zhoucang')!.position).toEqual({ q: -1, r: 0 }) // 周仓被挡在城格外
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')).toBeDefined() // 孙乾访问中仍在地图上
  })

  test('garrisonTown：驻城槽被占时拒绝访问武将进驻（防覆盖丢失驻城武将）', () => {
    const store = makeCampaignStore()
    // 孙乾进驻
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    // 周仓访问（孙乾已从 heroes 移除，城格空闲可走上）
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-zhoucang', townId: 't-dongling' })
    // 周仓尝试进驻 → 被拒绝（驻城槽被孙乾占），不覆盖丢失驻城武将
    store.dispatch('hero/garrison', { heroId: 'g-zhoucang', townId: 't-dongling' })
    const s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-sunqian')
    expect(s.towns[0]!.visitorGeneralId).toBe('g-zhoucang')
    expect(s.heroes.find((h) => h.generalId === 'g-zhoucang')).toBeDefined() // 周仓仍是访问者在地图上
  })

  test('移兵 clamp：不能移超过可用数；from=garrison 反向', () => {
    const store = makeCampaignStore()
    // 孙乾进城驻守
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    // 移 999 → clamp 到全量（孙乾 militia 15 支）
    store.dispatch('town/transferTroops', { townId: 't-dongling', from: 'hero', defId: 'militia', count: 999 })
    let s = store.getState()
    expect(s.towns[0]!.garrison.find((u) => u.defId === 'militia')!.count).toBe(15)
    // 全移走后英雄 army 里该条目删除
    expect(s.generals.find((g) => g.id === 'g-sunqian')!.army.find((u) => u.defId === 'militia')).toBeUndefined()
    // 从 garrison 移回 10 → 英雄 army 恢复 10，garrison 剩 5
    store.dispatch('town/transferTroops', { townId: 't-dongling', from: 'garrison', defId: 'militia', count: 10 })
    s = store.getState()
    expect(s.towns[0]!.garrison).toEqual([{ defId: 'militia', count: 5 }])
    expect(s.generals.find((g) => g.id === 'g-sunqian')!.army.find((u) => u.defId === 'militia')!.count).toBe(10)
  })

  test('swapHeroes：双槽都占 → 互换（槽位互换 + heroes 成员切换）', () => {
    const store = makeCampaignStore()
    // 孙乾进城并驻守
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    // 周仓进城访问（孙乾驻城后从 heroes 移除，城格空闲）
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-zhoucang', townId: 't-dongling' })
    let s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-sunqian')
    expect(s.towns[0]!.visitorGeneralId).toBe('g-zhoucang')
    // 互换：garrison↔visitor + heroes 成员切换
    store.dispatch('town/swapHeroes', { townId: 't-dongling' })
    s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-zhoucang')
    expect(s.towns[0]!.visitorGeneralId).toBe('g-sunqian')
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')!.position).toEqual({ q: 0, r: 0 }) // 原驻城孙乾回 heroes
    expect(s.heroes.find((h) => h.generalId === 'g-zhoucang')).toBeUndefined() // 原访问周仓进 garrison 移除
  })

  test('swapHeroes：只有访问、无驻城 → 访问进驻（移入 garrison，从 heroes 移除）', () => {
    const store = makeCampaignStore()
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('town/swapHeroes', { townId: 't-dongling' })
    const s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-sunqian')
    expect(s.towns[0]!.visitorGeneralId).toBeNull()
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')).toBeUndefined() // 进驻 → 从 heroes 移除
  })

  test('swapHeroes：只有驻城、无访问 → 驻城武将出城（garrison 清空，回 heroes 位置=城格）', () => {
    const store = makeCampaignStore()
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('town/swapHeroes', { townId: 't-dongling' })
    const s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBeNull()
    expect(s.towns[0]!.visitorGeneralId).toBeNull()
    const back = s.heroes.find((h) => h.generalId === 'g-sunqian')!
    expect(back.position).toEqual({ q: 0, r: 0 }) // 驻城武将出城回 heroes
  })
})

describe('MapMovementCost 守将格拦截', () => {
  test('garrisonAt 返回 true 的格代价 Infinity', () => {
    const cost = new MapMovementCost({
      terrainAt: () => 'plain',
      fogAt: () => 'explored',
      garrisonAt: (h) => hexKey(h) === '0,1'
    })
    expect(cost.cost({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(Number.POSITIVE_INFINITY)
    expect(cost.cost({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
  })
})
