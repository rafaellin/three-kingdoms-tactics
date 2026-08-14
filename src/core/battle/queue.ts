/**
 * 行动顺序条视图数据派生（纯函数，零 Phaser）。
 * 从 BattleState 派生「当前回合行动顺序条」要显示的条目：
 * 按 state.order 顺序，跳过已阵亡单位在 order 里的残留 id。
 * 跨回合重排由 battleReducer.advance() 负责（order 已按剩余部队当前速度重建），本函数只做投影。
 */
import type { UnitDefId } from '../../data/units'
import type { BattleState, BattleUnit } from './types'

export interface TurnOrderEntry {
  unitId: string
  side: BattleUnit['side']
  defId: UnitDefId
  hasActed: boolean
}

export function buildTurnOrderQueue(state: Pick<BattleState, 'order' | 'units'>): TurnOrderEntry[] {
  const byId = new Map(state.units.map((u) => [u.id, u]))
  const entries: TurnOrderEntry[] = []
  for (const id of state.order) {
    const unit = byId.get(id)
    if (!unit) continue
    entries.push({ unitId: unit.id, side: unit.side, defId: unit.defId, hasActed: unit.hasActed })
  }
  return entries
}
