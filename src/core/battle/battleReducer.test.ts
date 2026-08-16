import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { hexKey } from '../hex/HexGrid'
import { battleReducer, canRetaliate, createInitialBattleState } from './battleReducer'
import { buildBattleResult } from './result'
import { computeActualAttack, computeActualDefense } from './damage'
import type { BattleArmyConfig, BattleGeneralConfig, BattleState } from './types'

const TEST_GRID = { cols: 13, rows: 9 }
const TEST_ARMIES = {
  player: { side: 'player' as const, generalName: '关羽', atkBonus: 30, defBonus: 23,
    units: [{ defId: 'militia', count: 30 }, { defId: 'cavalry', count: 8 }] },
  enemy: { side: 'enemy' as const, generalName: '吕布', atkBonus: 33, defBonus: 27,
    units: [{ defId: 'archer', count: 8 }] }
}

function makeStore(opts?: { player?: BattleArmyConfig; enemy?: BattleArmyConfig; grid?: { cols: number; rows: number; obstacles?: { q: number; r: number }[] }; enter?: { playerGold: number; opponentKind: 'faction' | 'wild' } }) {
  const store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
  store.dispatch('battle/init', {
    player: opts?.player ?? TEST_ARMIES.player,
    enemy: opts?.enemy ?? TEST_ARMIES.enemy,
    grid: opts?.grid ?? TEST_GRID,
    playerGold: opts?.enter?.playerGold,
    opponentKind: opts?.enter?.opponentKind
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

describe('battle/wait 等待队列', () => {
  const mkWait = () =>
    makeStore({
      grid: { cols: 7, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [
          { defId: 'cavalry', count: 8, speed: 9 },   // A p0
          { defId: 'archer', count: 10, speed: 5 },   // B p1
          { defId: 'militia', count: 10, speed: 4 }   // C p2
        ] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0,
        units: [
          { defId: 'militia', count: 10, speed: 3 },  // X e0
          { defId: 'militia', count: 10, speed: 2 },  // Y e1
          { defId: 'militia', count: 10, speed: 1 }   // Z e2
        ] }
    })

  test('等待：当前单位移入 waitQueue 升序、normalQueue 收缩、不置 hasActed', () => {
    const store = mkWait()
    expect(store.getState().normalQueue).toEqual(['p0', 'p1', 'p2', 'e0', 'e1', 'e2'])
    store.dispatch('battle/wait', { unitId: 'p0' })
    let s = store.getState()
    expect(s.waitQueue).toEqual(['p0'])
    expect(s.normalQueue).toEqual(['p1', 'p2', 'e0', 'e1', 'e2'])
    expect(s.currentUnitId).toBe('p1')
    expect(s.units.find((u) => u.id === 'p0')!.hasActed).toBe(false)
    // B 等待 → 升序插入：B(5) 在 A(9) 前 → [B, A]
    store.dispatch('battle/wait', { unitId: 'p1' })
    s = store.getState()
    expect(s.waitQueue).toEqual(['p1', 'p0'])
    expect(s.normalQueue).toEqual(['p2', 'e0', 'e1', 'e2'])
  })

  test('用户例子全流程：AB等待→BA、X减速A→AB、Y等待→YAB、Y减速B→YBA', () => {
    const store = mkWait()
    store.dispatch('battle/wait', { unitId: 'p0' })   // A 等待
    store.dispatch('battle/wait', { unitId: 'p1' })   // B 等待
    expect(store.getState().waitQueue).toEqual(['p1', 'p0'])      // B,A
    expect(store.getState().normalQueue).toEqual(['p2', 'e0', 'e1', 'e2'])
    store.dispatch('battle/endTurn', { unitId: 'p2' })            // C 行动
    expect(store.getState().normalQueue).toEqual(['e0', 'e1', 'e2'])
    // X(e0) 行动时减速 A → A(4) 比 B(5) 慢 → wait 段整体升序重排 [A,B]
    store.dispatch('battle/speedMod', { unitId: 'p0', delta: -5 })
    store.dispatch('battle/endTurn', { unitId: 'e0' })
    expect(store.getState().waitQueue).toEqual(['p0', 'p1'])      // A,B
    // Y(e1) 等待 → 升序插入 Y(2) → Y,A,B
    store.dispatch('battle/wait', { unitId: 'e1' })
    expect(store.getState().waitQueue).toEqual(['e1', 'p0', 'p1']) // Y,A,B
    expect(store.getState().normalQueue).toEqual(['e2'])
    // Z(e2) 行动 → normal 空 → wait 段开始，current=Y
    store.dispatch('battle/endTurn', { unitId: 'e2' })
    expect(store.getState().normalQueue).toEqual([])
    expect(store.getState().currentUnitId).toBe('e1')
    // Y 行动时减速 B → B(1) 比 A(4)、Y(2) 都慢 → 保留当前 Y，尾部升序 → [Y,B,A]
    store.dispatch('battle/speedMod', { unitId: 'p1', delta: -4 })
    expect(store.getState().waitQueue).toEqual(['e1', 'p1', 'p0']) // Y,B,A
  })

  test('已等待单位再行动时不能再次等待（在 waitQueue 的当前单位 wait → no-op）', () => {
    const store = mkWait()
    store.dispatch('battle/wait', { unitId: 'p0' })
    store.dispatch('battle/wait', { unitId: 'p1' })
    store.dispatch('battle/endTurn', { unitId: 'p2' })
    store.dispatch('battle/endTurn', { unitId: 'e0' })
    store.dispatch('battle/wait', { unitId: 'e1' })
    store.dispatch('battle/endTurn', { unitId: 'e2' })
    expect(store.getState().currentUnitId).toBe('e1') // wait 段队首
    store.dispatch('battle/wait', { unitId: 'e1' })   // 已等待过 → no-op
    expect(store.getState().currentUnitId).toBe('e1')
    expect(store.getState().waitQueue).toEqual(['e1', 'p1', 'p0'])
  })
})

describe('battle/defend + 加成链', () => {
  test('defend：defending=true、hasActed=true、落 completedQueue、log', () => {
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 10 }] }
    })
    store.dispatch('battle/defend', { unitId: 'p0' })
    const s = store.getState()
    const p0 = s.units.find((u) => u.id === 'p0')!
    expect(p0.defending).toBe(true)
    expect(p0.hasActed).toBe(true)
    expect(s.completedQueue).toEqual(['p0'])
    expect(s.currentUnitId).toBe('e0') // 同速（民兵4=刀兵4）玩家先行，p0 已行动 → e0 当前
  })

  test('defend +2 防御减少所受伤害；下次行动后过期', () => {
    // p0 民兵防4 defend → 防4+2=6；e0 刀兵攻6 → 差0 → ×1.0 → 伤 round(10×4×1.0)=40
    // 未 defend 时差+2 → ×1.1 → 44
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 10 }] }
    })
    store.dispatch('battle/defend', { unitId: 'p0' })
    store.dispatch('battle/attack', { unitId: 'e0', targetId: 'p0', to: { q: 1, r: 0 } }) // e0(1,0) 原地攻击贴身的 p0
    let s = store.getState()
    expect(s.units.find((u) => u.id === 'p0')!.hpLeft).toBe(60) // 100 - 40（+2 防减伤）
    // p0 未反击、主攻不自动推进 → 手动 battle/advance 开新回合
    store.dispatch('battle/advance')
    s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.units.find((u) => u.id === 'p0')!.defending).toBe(true) // 跨回合保留
    expect(s.currentUnitId).toBe('p0') // 同速玩家先行
    store.dispatch('battle/endTurn', { unitId: 'p0' }) // p0 下次行动 → defending 清除
    expect(store.getState().units.find((u) => u.id === 'p0')!.defending).toBe(false)
  })

  test('加成链：mods 点数 + 百分比 + defending +2', () => {
    expect(computeActualDefense('militia', 0, undefined, true)).toBe(6)      // 4+0+0+2
    expect(computeActualDefense('militia', 0, { def: 3 }, true)).toBe(9)     // (4+3+2)×1
    expect(computeActualDefense('militia', 0, { def: 3, defPct: 0.5 }, true)).toBe(13.5) // (4+3+2)×1.5
    expect(computeActualDefense('militia', 0, { defPct: 0.1 }, false)).toBeCloseTo(4.4)
    expect(computeActualAttack('swordsman', 6, { atk: 2, atkPct: 0.1 })).toBeCloseTo(15.4) // (6+6+2)×1.1
  })
})

describe('降/逃/和', () => {
  const mkEnter = (enter?: Partial<{ playerGold: number; opponentKind: 'faction' | 'wild' }>) =>
    makeStore({ enter: { playerGold: 10000, opponentKind: 'faction', ...enter } })

  test('surrender：phase=lost、outcome=surrendered', () => {
    const store = mkEnter()
    store.dispatch('battle/surrender')
    const s = store.getState()
    expect(s.phase).toBe('lost')
    expect(s.outcome).toBe('surrendered')
  })
  test('flee：phase=fled、outcome=fled', () => {
    const store = mkEnter()
    store.dispatch('battle/flee')
    const s = store.getState()
    expect(s.phase).toBe('fled')
    expect(s.outcome).toBe('fled')
  })
  test('negotiate：金钱足够且非野怪 → phase=negotiated', () => {
    const store = mkEnter()
    store.dispatch('battle/negotiate')
    expect(store.getState().phase).toBe('negotiated')
  })
  test('negotiate：金钱不足 → 拒绝', () => {
    const store = mkEnter({ playerGold: 0 })
    store.dispatch('battle/negotiate')
    expect(store.getState().phase).toBe('combat')
  })
  test('negotiate：野怪不可议和 → 拒绝', () => {
    const store = mkEnter({ opponentKind: 'wild' })
    store.dispatch('battle/negotiate')
    expect(store.getState().phase).toBe('combat')
  })
})

describe('battle/init 武将当前属性', () => {
  const GUAN_GENERAL: BattleGeneralConfig = {
    name: '关羽',
    level: 1,
    stats: { atk: 90, def: 70, int: 50, pol: 60, cha: 80 },
    passives: [{ name: '铁壁', level: 1 }]
  }
  test('有 general：六维/攻防加成/蓝量/被动正确', () => {
    const s = makeStore({
      player: { side: 'player', general: GUAN_GENERAL, units: [{ defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] }
    }).getState()
    const g = s.general.player
    expect(g.name).toBe('关羽')
    expect(g.stats).toEqual({ atk: 90, def: 70, int: 50, pol: 60, cha: 80 })
    expect(g.atkBonus).toBe(30)   // round(90/3)
    expect(g.defBonus).toBe(23)   // round(70/3)
    expect(g.level).toBe(1)
    expect(g.maxMana).toBe(50)    // round(int50 × MANA_COEF1)
    expect(g.currentMana).toBe(50)
    expect(g.passives).toEqual([{ name: '铁壁', level: 1 }])
  })
  test('无 general：旧字段反推展示值，行为不变', () => {
    const s = makeStore().getState() // TEST_ARMIES: atkBonus30/defBonus23, generalName '关羽'
    const g = s.general.player
    expect(g.name).toBe('关羽')
    expect(g.atkBonus).toBe(30)
    expect(g.defBonus).toBe(23)
    expect(g.stats).toEqual({ atk: 90, def: 69, int: 0, pol: 0, cha: 0 }) // atk=30×3, def=23×3
    expect(g.level).toBe(1)
    expect(g.maxMana).toBe(0)
    expect(g.currentMana).toBe(0)
    expect(g.passives).toEqual([])
  })
})

describe('killedHp 累计（胜利经验 = 我方歼灭敌方 hp×count 总和）', () => {
  test('射击灭队：killedHp.player += count×hp，战胜 expGained 结算', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 3 }] } // 3×hp10=30
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
    expect(s.killedHp.player).toBe(30) // 3 × hp10
    expect(buildBattleResult(s).expGained).toBe(30)
  })

  test('敌方灭我方：killedHp.enemy 累计；战败不给经验', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 1 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/endTurn', { unitId: 'p0' }) // 同速玩家先行 → 玩家结束，敌方行动
    store.dispatch('battle/attack', { unitId: 'e0', targetId: 'p0', to: { q: 1, r: 0 } })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'p0')).toBeUndefined()
    expect(s.phase).toBe('lost')
    expect(s.killedHp.enemy).toBe(10) // 1 × hp10
    expect(buildBattleResult(s).expGained).toBe(0)
  })

  test('未全灭（stack 存活）不计 killedHp', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeDefined()
    expect(s.killedHp.player).toBe(0)
  })
})
