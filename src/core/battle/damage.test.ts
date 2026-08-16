import { describe, expect, test } from 'vitest'
import { ATK_OVER_DEF_MOD, computeActualAttack, computeActualDefense, computeDamage, DEF_OVER_ATK_MOD, MAX_ATK_FACTOR, MELEE_ATTACK_MULT, MIN_ATK_FACTOR } from './damage'
import type { BattleUnit } from './types'

const unit = (over: Partial<BattleUnit>): BattleUnit => ({
  id: 'u', side: 'player', defId: 'militia', count: 10, position: { q: 0, r: 0 }, size: 1,
  hpLeft: 30, maxHp: 30, hasActed: false, hasMoved: false, retaliated: false, ...over
})

describe('伤害公式（HOMM3 式攻防修正）', () => {
  test('实际攻防 = 兵种基础 + 武将加成（mods/defending 可选）', () => {
    expect(computeActualAttack('militia', 30)).toBe(34)   // (4 + 30 + 0) × 1
    expect(computeActualDefense('militia', 27)).toBe(31)  // (4 + 27 + 0 + 0) × 1
    // 新签名：mods 点数/百分比 与 defending +2 生效
    expect(computeActualAttack('militia', 30, { atk: 1, atkPct: 0.1 })).toBeCloseTo(38.5)   // (4+30+1)×1.1
    expect(computeActualDefense('militia', 27, { def: 1, defPct: 0.1 }, true)).toBeCloseTo(37.4) // (4+27+1+2)×1.1
  })
  test('基础伤害 × count × 修正，含舍入', () => {
    // 民兵伤害区间 1~3 中值 2；count 10；atkBonus 30 → 攻 34，defBonus 27 → 防 31，差 3
    // → 10 × 2 × (1 + 0.05×3) = 23
    const a = unit({ defId: 'militia', count: 10 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 50, maxHp: 50 })
    expect(computeDamage(a, t, 30, 27)).toBe(23)
  })
  test('攻防差非对称修正：攻≥防 +5%/点（上限+300%）、防>攻 -2.5%/点（下限-70%）', () => {
    const a = unit({ defId: 'militia', count: 1 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 10, maxHp: 10 })
    // 攻104 防4 差+100 → 系数 min(4.0, 1+0.05×100)=4.0 → 1×2×4.0 = 8
    expect(computeDamage(a, t, 100, 0)).toBe(8)
    // 攻4 防104 差-100 → 系数 max(0.3, 1-0.025×100)=0.3 → 1×2×0.3=0.6 → round→1 → max(1,..)=1
    expect(computeDamage(a, t, 0, 100)).toBe(1)
  })
  test('伤害至少为 1（不为 0）', () => {
    const a = unit({ defId: 'militia', count: 1 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 10, maxHp: 10 })
    expect(computeDamage(a, t, 0, 1000)).toBeGreaterThanOrEqual(1)
  })
  test('修正倍率由可调常量驱动（平衡旋钮）', () => {
    // 四个常量均导出为 number；攻/防两段斜率与上下限符合同一量级
    expect(typeof ATK_OVER_DEF_MOD).toBe('number')
    expect(typeof DEF_OVER_ATK_MOD).toBe('number')
    expect(typeof MAX_ATK_FACTOR).toBe('number')
    expect(typeof MIN_ATK_FACTOR).toBe('number')
    expect(ATK_OVER_DEF_MOD).toBeGreaterThan(0)
    expect(DEF_OVER_ATK_MOD).toBeGreaterThan(0)
    expect(MAX_ATK_FACTOR).toBeGreaterThan(1)
    expect(MIN_ATK_FACTOR).toBeLessThan(1)
  })
  test('attackMult 倍率生效（远程兵近战 30% 攻）', () => {
    // 弓兵攻6 ×0.3 = 1.8，民兵防4 → 差 -2.2 → ×0.945 → round(10×3×0.945)=28
    const a = unit({ defId: 'archer', count: 10 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 50, maxHp: 50 })
    expect(computeDamage(a, t, 0, 0, MELEE_ATTACK_MULT)).toBe(28)
  })
})
