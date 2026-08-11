/**
 * 伤害公式（纯函数，确定性）。
 * 实际攻防 = 兵种基础攻防 + 武将武力/统御加成（PRD §7.3）。
 * damage = 基础伤害(区间中值) × count × [1 + ATK_DEF_MODIFIER × clamp(攻-防, ±ATK_DEF_CAP)]
 * ATK_DEF_MODIFIER / ATK_DEF_CAP 是平衡旋钮（用户指定可调）。
 */
import { UNIT_DEFS, type UnitDefId } from '../../data/units'
import type { BattleUnit } from './types'

export const ATK_DEF_MODIFIER = 0.05
export const ATK_DEF_CAP = 3
export const MELEE_ATTACK_MULT = 0.3 // 远程兵近战时攻击取值倍率
export const RANGE_OUT_MULT = 0.5 // 射程外远程伤害倍率（作用于最终伤害）

export function computeActualAttack(defId: UnitDefId, atkBonus: number): number {
  return UNIT_DEFS[defId].attack + atkBonus
}

export function computeActualDefense(defId: UnitDefId, defBonus: number): number {
  return UNIT_DEFS[defId].defense + defBonus
}

export function computeDamage(attacker: BattleUnit, target: BattleUnit, atkBonus: number, defBonus: number, attackMult = 1): number {
  const att = computeActualAttack(attacker.defId, atkBonus) * attackMult
  const def = computeActualDefense(target.defId, defBonus)
  const diff = Math.max(-ATK_DEF_CAP, Math.min(ATK_DEF_CAP, att - def))
  const mid = (UNIT_DEFS[attacker.defId].minDamage + UNIT_DEFS[attacker.defId].maxDamage) / 2
  return Math.max(1, Math.round(attacker.count * mid * (1 + ATK_DEF_MODIFIER * diff)))
}
