/**
 * 战斗结算（纯函数，零 Phaser）。
 * 降/逃/和 与自然胜败统一由 buildBattleResult 收敛为 BattleResult，
 * 交给探索层决定后续（经验、金币结算、俘虏、剩余部队）。
 */
import { UNIT_DEFS } from '../../data/units'
import type { BattleResult, BattleState } from './types'

export const BAIL_RATIO = 1.5

/** 保释金 = 我方剩余部队金币价值 × BAIL_RATIO（round）；仅统计玩家侧（敌方部队不计入） */
export function computeBail(state: BattleState): number {
  const value = state.units
    .filter((u) => u.side === 'player')
    .reduce((sum, u) => sum + u.count * UNIT_DEFS[u.defId].cost.gold, 0)
  return Math.round(value * BAIL_RATIO)
}

export function buildBattleResult(state: BattleState): BattleResult {
  const outcome = state.outcome ?? 'lost'
  const zeroed = outcome === 'surrendered' || outcome === 'fled'
  return {
    outcome,
    remainingTroops: zeroed ? [] : state.units.filter((u) => u.side === 'player').map((u) => ({ defId: u.defId, count: u.count })),
    expGained: 0, // 经验系统将来填（仅战胜）
    goldSettlement: outcome === 'negotiated' ? -computeBail(state) : 0,
    generalCaptured: outcome === 'surrendered' ? true : outcome === 'fled' || outcome === 'negotiated' ? false : null
  }
}
