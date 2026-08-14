import { describe, expect, test } from 'vitest'
import { ATK_DEF_CAP, ATK_DEF_MODIFIER, computeActualAttack, computeActualDefense, computeDamage, MELEE_ATTACK_MULT } from './damage'
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
  test('攻防差钳制在 ±ATK_DEF_CAP', () => {
    const a = unit({ defId: 'militia', count: 1 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 10, maxHp: 10 })
    // 攻远大于防：差钳到 +CAP
    expect(computeDamage(a, t, 100, 0)).toBe(Math.round(1 * 2 * (1 + ATK_DEF_MODIFIER * ATK_DEF_CAP)))
    // 攻远小于防：差钳到 -CAP
    expect(computeDamage(a, t, 0, 100)).toBe(Math.round(1 * 2 * (1 - ATK_DEF_MODIFIER * ATK_DEF_CAP)))
  })
  test('伤害至少为 1（不为 0）', () => {
    const a = unit({ defId: 'militia', count: 1 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 10, maxHp: 10 })
    expect(computeDamage(a, t, 0, 1000)).toBeGreaterThanOrEqual(1)
  })
  test('修正倍率由可调常量驱动（平衡旋钮）', () => {
    // 常量必须导出为 number；上面的钳制测试已用 ATK_DEF_MODIFIER 断言倍率生效
    expect(typeof ATK_DEF_MODIFIER).toBe('number')
    expect(ATK_DEF_CAP).toBeGreaterThan(0)
  })
  test('attackMult 倍率生效（远程兵近战 30% 攻）', () => {
    // 弓兵攻6 ×0.3 = 1.8，民兵防4 → 差 -2.2 → ×0.89 → round(10×3×0.89)=27
    const a = unit({ defId: 'archer', count: 10 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 50, maxHp: 50 })
    expect(computeDamage(a, t, 0, 0, MELEE_ATTACK_MULT)).toBe(27)
  })
})
