/**
 * 战役命令集测试：campaign/start · hero/select · hero/move（守将格拦截）·
 * 城池交互（enterTown/garrison/leaveTown/swapHeroes/transferTroops）·
 * 战斗回流（resolveBattle → 守将 alive=false + 经验 + checkVictory）·
 * MapMovementCost 守将格不可通行。
 * 全部走确定性 reducer（CommandLog 折叠），无浏览器依赖。
 */
import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { hexKey } from '../hex/HexGrid'
import { MapMovementCost } from '../pathfinding/MapMovementCost'
import { createInitialState, type GameState } from './GameState'
import { gameReducer } from './reducer'
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
    expect(c.garrisons).toHaveLength(1)
    expect(c.garrisons[0]!.id).toBe('gar-kongxiu')
    expect(c.garrisons[0]!.alive).toBe(true)
    expect(c.victory?.kind).toBe('defeatGarrison')
    expect(c.heroes).toHaveLength(3)
    expect(c.selectedHeroId).toBe('g-guan')
    expect(c.heroes[0]!.faction).toBe('shu')
    expect(c.outcome).toBeNull()

    const e = makeCampaignStore('explore').getState()
    expect(e.garrisons).toHaveLength(0)
    expect(e.victory).toBeNull()
    expect(e.heroes).toHaveLength(3)
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

describe('hero/move 英雄移动（守将格拦截）', () => {
  test('目标格是存活守将格 → 拒绝（不可通行）', () => {
    const store = makeCampaignStore()
    // 关羽在 (0,-1)，走到 (0,0) 后再试图进 (0,1)（孔秀格）
    store.dispatch('hero/select', { heroId: 'g-guan' })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 1 } })
    const s = store.getState()
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 0 }) // 停在 (0,0)，进不了孔秀格
    expect(s.heroes.find((h) => h.generalId === 'g-guan')?.movementLeft).toBe(5) // 只扣了一次平地
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
    // 孙乾进城
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    let s = store.getState()
    expect(s.towns[0]!.visitorGeneralId).toBe('g-sunqian')
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')).toBeUndefined() // 进城后不再在地图上
    // 驻守
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-sunqian')
    expect(s.towns[0]!.visitorGeneralId).toBeNull()
    // 移兵进城（英雄 army → 城 garrison）
    store.dispatch('town/transferTroops', { townId: 't-dongling', from: 'hero', defId: 'militia', count: 5 })
    s = store.getState()
    expect(s.towns[0]!.garrison).toEqual([{ defId: 'militia', count: 5 }])
    const sunqian = s.generals.find((g) => g.id === 'g-sunqian')!
    expect(sunqian.army.find((u) => u.defId === 'militia')!.count).toBe(10) // 15 - 5
    // 出城 → 回 heroes，位置=城格、满移动力
    store.dispatch('hero/leaveTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBeNull()
    const back = s.heroes.find((h) => h.generalId === 'g-sunqian')!
    expect(back.position).toEqual({ q: 0, r: 0 })
    expect(back.movementLeft).toBe(6)
    expect(back.faction).toBe('shu')
  })

  test('enterTown：访问槽被占时拒绝第二英雄进城（不覆盖丢失武将）', () => {
    const store = makeCampaignStore()
    // 孙乾进城成为访问武将
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    // 周仓也走到城格尝试进城 → 拒绝：孙乾仍是访问武将、周仓仍在地图上（不静默丢失）
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-zhoucang', townId: 't-dongling' })
    const s = store.getState()
    expect(s.towns[0]!.visitorGeneralId).toBe('g-sunqian') // 原访问武将未被覆盖
    expect(s.heroes.find((h) => h.generalId === 'g-zhoucang')).toBeDefined() // 周仓仍在地图上
    expect(s.heroes.find((h) => h.generalId === 'g-sunqian')).toBeUndefined() // 孙乾仍在城内
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

  test('swapHeroes：驻守/访问互换（都非空才换）', () => {
    const store = makeCampaignStore()
    // 孙乾进城并驻守
    store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
    store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
    // 周仓进城访问（路径 (-1,-1)→(-1,0)→(0,0)）
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: -1, r: 0 } })
    store.dispatch('hero/move', { heroId: 'g-zhoucang', to: { q: 0, r: 0 } })
    store.dispatch('hero/enterTown', { heroId: 'g-zhoucang', townId: 't-dongling' })
    let s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-sunqian')
    expect(s.towns[0]!.visitorGeneralId).toBe('g-zhoucang')
    // 互换
    store.dispatch('town/swapHeroes', { townId: 't-dongling' })
    s = store.getState()
    expect(s.towns[0]!.garrisonGeneralId).toBe('g-zhoucang')
    expect(s.towns[0]!.visitorGeneralId).toBe('g-sunqian')
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
