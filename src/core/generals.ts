/**
 * 当前属性值推导（core 逻辑，纯函数）。
 * 低起步 → 20 级锚点全程线性插值：当前 = round(base + (lv20-base)×(L-1)/19)。
 * Lv20 后斜率不变（不减速）继续线性；Lv<1 按 Lv1 处理（不倒退）。
 * 这是升级系统（PRD §16）的接缝：装备/技能加成将来在此叠加。
 */
import type { GeneralBase } from '../data/generals'
import type { GeneralStats } from './state/GameState'

/** 成长锚定等级 */
export const ANCHOR_LEVEL = 20

export function deriveStats(base: GeneralBase, level: number): GeneralStats {
  const L = Math.max(1, level)
  const grow = (b: number, t: number) =>
    Math.round(b + (t - b) * (L - 1) / (ANCHOR_LEVEL - 1))
  return {
    atk: grow(base.base.atk, base.lv20.atk),
    def: grow(base.base.def, base.lv20.def),
    int: grow(base.base.int, base.lv20.int),
    pol: grow(base.base.pol, base.lv20.pol),
    cha: grow(base.base.cha, base.lv20.cha)
  }
}
