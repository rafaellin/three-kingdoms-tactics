import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { hexKey } from '../hex/HexGrid'
import { battleReducer, canRetaliate, createInitialBattleState } from './battleReducer'
import type { BattleArmyConfig, BattleState } from './types'

const TEST_GRID = { cols: 13, rows: 9 }
const TEST_ARMIES = {
  player: { side: 'player' as const, generalName: '关羽', atkBonus: 30, defBonus: 23,
    units: [{ defId: 'militia', count: 30 }, { defId: 'cavalry', count: 8 }] },
  enemy: { side: 'enemy' as const, generalName: '吕布', atkBonus: 33, defBonus: 27,
    units: [{ defId: 'archer', count: 8 }] }
}

function makeStore(opts?: { player?: BattleArmyConfig; enemy?: BattleArmyConfig; grid?: { cols: number; rows: number; obstacles?: { q: number; r: number }[] } }) {
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
    expect(mil?.maxHp).toBe(300)   // 30 × hp10
    expect(mil?.hpLeft).toBe(300)
    // 骑兵 speed9 > 弓兵5 > 民兵4 → 行动序 [cavalry, archer, militia]
    const cavalryId = s.units.find((u) => u.defId === 'cavalry')?.id
    expect(s.normalQueue[0]).toBe(cavalryId)
    expect(s.currentUnitId).toBe(cavalryId)
  })
  test('玩家单位在左 (q=0)、敌方在右 (q=cols-2)', () => {
    const s = makeStore().getState()
    expect(s.units.filter((u) => u.side === 'player').every((u) => u.position.q === 0)).toBe(true)
    expect(s.units.find((u) => u.side === 'enemy')?.position.q).toBe(s.grid.cols - 2)
  })
  test('init 带入障碍物；单位 retaliated 初始 false', () => {
    const store = makeStore({
      grid: { cols: 13, rows: 9, obstacles: [{ q: 2, r: 0 }] }
    })
    const s = store.getState()
    expect(s.obstacles).toEqual([{ q: 2, r: 0 }])
    expect(s.units.every((u) => u.retaliated === false)).toBe(true)
  })
})

describe('battle/endTurn 回合推进', () => {
  test('行动完跳到下一单位；全动完 turn+1 重排', () => {
    const store = makeStore()
    const ids = store.getState().normalQueue
    for (const id of ids.slice(0, -1)) {
      store.dispatch('battle/endTurn', { unitId: id })
      expect(store.getState().currentUnitId).toBe(ids[ids.indexOf(id) + 1])
    }
    store.dispatch('battle/endTurn', { unitId: ids[ids.length - 1] as string })
    const s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.units.every((u) => !u.hasActed && !u.hasMoved && !u.retaliated)).toBe(true)
  })
  test('同速攻方先行：玩家单位排在敌方前', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 1 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 1 }] }
    })
    expect(store.getState().normalQueue[0]).toBe('p0')
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

describe('battle/move（移动即行动）', () => {
  test('移动到可达格：置 hasActed+hasMoved 并 advance', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId! // 骑兵（speed9，(0,1)）
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })
    const u = store.getState().units.find((x) => x.id === cur)!
    expect(hexKey(u.position)).toBe('1,0')
    expect(u.hasActed).toBe(true)
    expect(u.hasMoved).toBe(true)
    expect(store.getState().currentUnitId).not.toBe(cur) // 行动完 advance
  })
  test('不可达/越界/已行动 均为 no-op', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId!
    store.dispatch('battle/move', { unitId: cur, to: { q: 99, r: 99 } }) // 越界 → no-op
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('0,1')
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })  // 合法移动
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('1,0')
    // 已行动 → advance 后不再是当前单位 → 再移动 no-op
    store.dispatch('battle/move', { unitId: cur, to: { q: 2, r: 0 } })
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('1,0')
  })
})

describe('battle/attack（近战 v2 + 反击）', () => {
  test('带 to 冲锋近战：移动落点 + 全额伤害 + 触发全额反击', () => {
    // 5×3：p0 民兵20 (0,0) vs e0 刀兵20 (3,0)（q=cols-2，hp20 → 400 血池）
    // 民兵攻4 刀兵防8 → 差-4 钳-3 → ×0.85 → 伤 round(20×2×0.85)=34
    // e0 → 366hp count19；e0 反击 19×4×1.1=83.6→84 → p0 200-84=116 count12
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 2, r: 0 } }) // 主攻段
    store.dispatch('battle/retaliate', { retaliatorId: 'e0', victimId: 'p0' })            // 反击段（分段结算）
    const s = store.getState()
    const t = s.units.find((u) => u.id === 'e0')!
    const a = s.units.find((u) => u.id === 'p0')!
    expect(a.position).toEqual({ q: 2, r: 0 })
    expect(t.hpLeft).toBe(366)
    expect(t.count).toBe(19)         // ceil(366/20)
    expect(t.retaliated).toBe(true)
    expect(a.hpLeft).toBe(116)       // 200 - 84
    expect(a.count).toBe(12)
    expect(s.currentUnitId).toBe('e0') // 反击段 advance 到敌方未行动单位
  })
  test('每回合每个单位只反击一次', () => {
    // 同速（民兵4=刀兵4）攻方先行 → 序 [p0,p1,e0]
    // p0 冲锋：伤34 → e0 366hp count19、反击84 → p0 116hp
    // p1 从 (0,1) 冲锋到 (3,1)（e0 邻格）：伤 round(1×2×0.85)=2 → e0 364hp count19；e0 已反击 → 不再反击
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 1 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 2, r: 0 } }) // p0 主攻
    store.dispatch('battle/retaliate', { retaliatorId: 'e0', victimId: 'p0' })            // e0 反击 p0
    store.dispatch('battle/attack', { unitId: 'p1', targetId: 'e0', to: { q: 3, r: 1 } }) // p1 主攻
    store.dispatch('battle/advance')                                                      // e0 已反击 → 无反击，直接推进
    const s = store.getState()
    const t = s.units.find((u) => u.id === 'e0')!
    const p1 = s.units.find((u) => u.id === 'p1')!
    expect(t.hpLeft).toBe(364)
    expect(t.count).toBe(19)
    expect(p1.hpLeft).toBe(10)       // 无反击 → 满血（hp10）
    expect(p1.hasActed).toBe(true)
  })
  test('远程兵近战按 30% 攻取值；灭队即判胜', () => {
    // 弓兵100 攻6×0.3=1.8，民兵25 防4 → 差-2.2 → ×0.89 → 伤 round(100×3×0.89)=267 > 民兵25×hp10=250 池 → 全灭
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 100 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 25 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 1, r: 0 } })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
    expect(s.log.some((l) => l.includes('267'))).toBe(true)
  })
  test('1×2 骑兵原地攻击：目标贴自身东邻格即可（无需主体格相邻）', () => {
    // 骑兵 p0 (0,0) 占 (0,0)+(1,0)；敌 e0 (2,0) 贴东邻格 (1,0) 但距主体 (0,0) 为 2
    // 原地攻击 to=当前位：按攻击方完整体积判定相邻（回归 bug6）
    const store = makeStore({
      grid: { cols: 4, rows: 3 }, // e0 在 q=cols-2=2，贴骑兵东邻格 (1,0)
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 30 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 0, r: 0 } })
    const s = store.getState()
    // 攻击应命中：骑兵攻10 vs 民兵防4（差+6 ×1.3）×30×avg6.5 ≈ 254 > 民兵20×hp10=200 池 → 全灭
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.units.find((u) => u.id === 'p0')?.position).toEqual({ q: 0, r: 0 }) // 原地未动
  })
  test('no-op：落点不可达 / 不与目标相邻 / 无 to 直接点远处敌军 / 打己方', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 9, r: 9 } })   // ① 落点越界
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 1, r: 0 } })   // ② 落点不与目标相邻
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0' })                       // ③ 无 to 原地非相邻
    expect(store.getState().currentUnitId).toBe('p0')
    const store2 = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 5 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store2.dispatch('battle/attack', { unitId: 'p0', targetId: 'p1', to: { q: 2, r: 0 } })  // ④ 打己方
    expect(store2.getState().units.find((u) => u.id === 'p1')).toBeDefined()
  })
  test('canRetaliate：贴身且未反击才可反击（分段结算判定）', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] }
    })
    // e0 (2,0) 距 p0 (0,0) 2 → 不贴身 → 不能反击
    expect(canRetaliate(store.getState(), 'e0', 'p0')).toBe(false)
    // p0 冲锋到 (1,0) 贴身 e0 → e0 可反击
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 1, r: 0 } })
    expect(canRetaliate(store.getState(), 'e0', 'p0')).toBe(true)
    // e0 反击后 → 不能再反击（每回合一次）
    store.dispatch('battle/retaliate', { retaliatorId: 'e0', victimId: 'p0' })
    expect(canRetaliate(store.getState(), 'e0', 'p0')).toBe(false)
  })
})

describe('battle/shoot（远程）', () => {
  test('射程内满额（距离3 ≤ 射程6）：伤 round(10×3×1.1)=33', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    expect(store.getState().currentUnitId).toBe('p0') // archer speed5 > militia speed4
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(467)      // 民兵50×hp10=500 - 33
    expect(t.count).toBe(47)        // ceil(467/10)
  })
  test('射程外半额（距离7 > 射程6）：33×0.5=16.5→17，log 记「半额」', () => {
    const store = makeStore({
      grid: { cols: 9, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(483)      // 500 - 17
    expect(store.getState().log.some((l) => l.includes('半额'))).toBe(true)
  })
  test('1×2 目标：任意身体格在射程内即满额', () => {
    // e0 骑兵 (6,0) 占 (6,0)+(7,0)；距 (0,0) 为 6 ≤ 6 → 满额
    // 攻6 防7 → 差-1 → 0.95；mid 3（弓兵）→ 伤 round(10×3×0.95)=29 → 骑兵30×hp30=900-29=871 count=ceil(871/30)=30
    const store = makeStore({
      grid: { cols: 8, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 30 }] }
    })
    expect(store.getState().currentUnitId).toBe('e0') // cavalry speed9 先动
    store.dispatch('battle/endTurn', { unitId: 'e0' })
    expect(store.getState().currentUnitId).toBe('p0')
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(871)
    expect(t.count).toBe(30)
  })
  test('被贴身禁射：有敌军相邻则 shoot 为 no-op', () => {
    // 3×3：e0 民兵 (1,0) 贴身 p0 弓手 (0,0)
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'p0')!.hasActed).toBe(false)
    expect(s.currentUnitId).toBe('p0')
  })
  test('近战兵不能 shoot（range≤1 → no-op）', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    expect(store.getState().currentUnitId).toBe('p0')
  })
  test('射击伤害用目标方 defBonus（回归）', () => {
    // 攻6 防14 → 差-8 钳-3 → 0.85 → 伤 round(10×3×0.85)=26 → 民兵50×hp10=500-26=474
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 10, units: [{ defId: 'militia', count: 50 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(474)
    expect(t.count).toBe(48)         // ceil(474/10)
  })
  test('灭队即判胜', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 3 }] } // 3×hp10=30 < 33
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
  })
})

describe('battle/speedMod（中途速度变化重排）', () => {
  const mk = () =>
    makeStore({
      grid: { cols: 7, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'cavalry', count: 8 }, { defId: 'militia', count: 10 }, { defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] }
    })

  test('初始：骑兵9 最先，同速4 玩家先行', () => {
    const s = mk().getState()
    expect(s.currentUnitId).toBe('p0')
    expect(s.normalQueue).toEqual(['p0', 'p1', 'p2', 'e0'])
  })

  test('减速：p1 掉到 e0 之后（未行动段按 effectiveSpeed 重排），当前单位不变', () => {
    const store = mk()
    store.dispatch('battle/speedMod', { unitId: 'p1', delta: -2 }) // p1 速度 4→2
    const s = store.getState()
    expect(s.normalQueue).toEqual(['p0', 'p2', 'e0', 'p1'])
    expect(s.currentUnitId).toBe('p0')
    expect(s.log.some((l) => l.includes('速度-2（现 2）'))).toBe(true)
  })

  test('加速：p2 上移到紧接当前单位之后，不越过 p0', () => {
    const store = mk()
    store.dispatch('battle/speedMod', { unitId: 'p2', delta: 5 }) // p2 速度 4→9（与 p0 平速）
    const s = store.getState()
    expect(s.normalQueue[0]).toBe('p0')     // 当前单位仍居首（未被平速单位越过）
    expect(s.normalQueue).toEqual(['p0', 'p2', 'p1', 'e0']) // p2 紧接其后
  })

  test('对当前单位改速度：本回合 order/currentUnitId 不动，下回合排序带上修正', () => {
    const store = mk()
    store.dispatch('battle/speedMod', { unitId: 'p0', delta: 5 }) // p0 9→14
    expect(store.getState().normalQueue).toEqual(['p0', 'p1', 'p2', 'e0'])
    expect(store.getState().currentUnitId).toBe('p0')
    // 全员行动完 → turn 2 按新速度重排，p0 仍居首
    for (const id of ['p0', 'p1', 'p2', 'e0']) store.dispatch('battle/endTurn', { unitId: id })
    const s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.normalQueue).toEqual(['p0', 'p1', 'p2', 'e0'])
  })

  test('重排剔除阵亡残留（normalQueue 不再含已消灭单位）', () => {
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'militia', count: 1 }, { defId: 'militia', count: 1 }] }
    })
    expect(store.getState().normalQueue).toEqual(['p0', 'p1', 'e0', 'e1'])
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 0, r: 0 } }) // 原地近战灭 e0（e1 存活 → 战斗继续）
    expect(store.getState().units.find((u) => u.id === 'e0')).toBeUndefined()
    // attack 不推进：p0 已落 completedQueue，e0 仍残留 normalQueue
    expect(store.getState().normalQueue).toEqual(['p1', 'e0', 'e1'])
    store.dispatch('battle/advance') // 推进到 p1（当前单位回到 normalQueue 内）
    expect(store.getState().currentUnitId).toBe('p1')
    store.dispatch('battle/speedMod', { unitId: 'p1', delta: 0 }) // 触发重排 → 剔除 e0
    expect(store.getState().normalQueue).toEqual(['p1', 'e1'])
  })
})

describe('三队列（completedQueue/normalQueue/waitQueue）', () => {
  test('移动即行动后：单位移入 completedQueue，normalQueue 收缩', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId!
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })
    const s = store.getState()
    expect(s.completedQueue).toEqual([cur])
    expect(s.normalQueue).not.toContain(cur)
    expect(s.currentUnitId).toBe(s.normalQueue[0])
  })

  test('整回合结束：completedQueue 清空、normalQueue 重建、waitQueue 空', () => {
    const store = makeStore()
    const ids = store.getState().normalQueue
    for (const id of ids) store.dispatch('battle/endTurn', { unitId: id })
    const s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.completedQueue).toEqual([])
    expect(s.waitQueue).toEqual([])
    expect(s.normalQueue).toHaveLength(ids.length)
    expect(s.units.every((u) => !u.hasActed)).toBe(true)
  })
})
