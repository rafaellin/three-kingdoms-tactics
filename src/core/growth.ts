/**
 * 武将成长曲线（core 逻辑，纯函数）。
 * 经验等比软封顶（XP_GROWTH=1.2）；部队数上限 Lv1 起 4 支、每 5 级 +1、封顶 7。
 * 确定性：无随机；升级/经验结算由 reducer 的 general/gainXp 消费本模块。
 */
export const XP_BASE = 1000       // Lv1→2 所需经验
export const XP_GROWTH = 1.2      // 等比系数
export const MAX_LEVEL = 30       // 硬上限

/** 从 Lv 升到 Lv+1 所需经验（等比） */
export function xpToNext(level: number): number {
  return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1))
}

/** 部队数上限：Lv1 起 4 支，每 5 级 +1，封顶 7 */
export function maxUnits(level: number): number {
  return Math.min(7, 4 + Math.floor(level / 5))
}
