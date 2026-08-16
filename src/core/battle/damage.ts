/**
 * 伤害公式（纯函数，确定性）。
 * 实际攻防 = 兵种基础攻防 + 武将武力/统御加成（PRD §7.3）。
 * damage = 基础伤害(区间中值) × count × atkDefFactor(攻, 防)
 * HOMM3 非对称：攻≥防 每点 +5%（上限 +300% → 系数 4.0）；防>攻 每点 -2.5%（下限 -70% → 系数 0.3）。
 * ATK_OVER_DEF_MOD / DEF_OVER_ATK_MOD / MAX_ATK_FACTOR / MIN_ATK_FACTOR 是平衡旋钮（用户指定可调）。
 */
import { UNIT_DEFS, type UnitDefId } from '../../data/units'
import type { BattleUnit } from './types'

export const ATK_OVER_DEF_MOD = 0.05 // 攻≥防 每点 +5%
export const DEF_OVER_ATK_MOD = 0.025 // 防>攻 每点 -2.5%
export const MAX_ATK_FACTOR = 4.0 // 上限 +300%（系数 4.0）
export const MIN_ATK_FACTOR = 0.3 // 下限 -70%（系数 0.3）
export const MELEE_ATTACK_MULT = 0.3 // 远程兵近战时攻击取值倍率
export const RANGE_OUT_MULT = 0.5 // 射程外远程伤害倍率（作用于最终伤害）
export const DEFEND_BONUS = 2 // 防御指令带来的固定防御加成

export function computeActualAttack(defId: UnitDefId, atkBonus: number, mods?: { atk?: number; atkPct?: number }): number {
  const base = UNIT_DEFS[defId].attack + atkBonus + (mods?.atk ?? 0)
  return base * (1 + (mods?.atkPct ?? 0))
}

export function computeActualDefense(
  defId: UnitDefId,
  defBonus: number,
  mods?: { def?: number; defPct?: number },
  defending = false
): number {
  const base = UNIT_DEFS[defId].defense + defBonus + (mods?.def ?? 0) + (defending ? DEFEND_BONUS : 0)
  return base * (1 + (mods?.defPct ?? 0))
}

/** 攻防差 → 伤害修正系数（非对称）：攻≥防 +5%/点（上限系数 4.0）；防>攻 -2.5%/点（下限系数 0.3） */
function atkDefFactor(att: number, def: number): number {
  const diff = att - def
  return diff >= 0
    ? Math.min(MAX_ATK_FACTOR, 1 + ATK_OVER_DEF_MOD * diff)
    : Math.max(MIN_ATK_FACTOR, 1 - DEF_OVER_ATK_MOD * -diff)
}

export function computeDamage(attacker: BattleUnit, target: BattleUnit, atkBonus: number, defBonus: number, attackMult = 1): number {
  const att = computeActualAttack(attacker.defId, atkBonus, attacker.mods) * attackMult
  const def = computeActualDefense(target.defId, defBonus, target.mods, target.defending)
  const mid = (UNIT_DEFS[attacker.defId].minDamage + UNIT_DEFS[attacker.defId].maxDamage) / 2
  return Math.max(1, Math.round(attacker.count * mid * atkDefFactor(att, def)))
}
