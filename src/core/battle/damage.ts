/**
 * 伤害公式（纯函数，确定性）。
 * 实际攻防 = 兵种基础攻防 + 武将武力/统御加成（PRD §7.3）。
 * damage = 基础伤害(区间中值) × count × [1 + ATK_DEF_MODIFIER × clamp(攻-防, ±ATK_DEF_CAP)]
 * ATK_DEF_MODIFIER / ATK_DEF_CAP 是平衡旋钮（用户指定可调）。
 */
import { UNIT_DEFS } from '../../data/units'
import type { BattleUnit } from './types'

export const ATK_DEF_MODIFIER = 0.05
export const ATK_DEF_CAP = 3

export function computeActualAttack(defId: string, atkBonus: number): number {
  return UNIT_DEFS[defId].attack + atkBonus
}

export function computeActualDefense(defId: string, defBonus: number): number {
  return UNIT_DEFS[defId].defense + defBonus
}

export function computeDamage(attacker: BattleUnit, target: BattleUnit, atkBonus: number, defBonus: number): number {
  const att = computeActualAttack(attacker.defId, atkBonus)
  const def = computeActualDefense(target.defId, defBonus)
  const diff = Math.max(-ATK_DEF_CAP, Math.min(ATK_DEF_CAP, att - def))
  const mid = (UNIT_DEFS[attacker.defId].minDamage + UNIT_DEFS[attacker.defId].maxDamage) / 2
  return Math.max(1, Math.round(attacker.count * mid * (1 + ATK_DEF_MODIFIER * diff)))
}
