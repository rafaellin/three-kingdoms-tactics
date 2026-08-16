/**
 * 当前属性值推导（core 逻辑，纯函数）。
 * 当前 = 基础 + (level-1)×每级成长（占位线性；装备/技能加成将来叠加）。Lv1 = 基础值。
 * 这是升级系统（PRD §16）的接缝：将来升级/装备/技能在此叠加。
 */
import type { GeneralBase } from '../data/generals'
import type { GeneralStats } from './state/GameState'

export function deriveStats(base: GeneralBase, level: number): GeneralStats {
  const g = Math.max(0, level - 1)
  return {
    atk: base.baseAtk + g * base.growthPerLevel.atk,
    def: base.baseDef + g * base.growthPerLevel.def,
    int: base.baseInt + g * base.growthPerLevel.int,
    pol: base.basePol + g * base.growthPerLevel.pol,
    cha: base.baseCha + g * base.growthPerLevel.cha
  }
}
