/**
 * 行动顺序条视图数据派生（纯函数，零 Phaser）。
 * 从 BattleState 派生「当前回合行动顺序条」要显示的条目：
 * 按 completedQueue → normalQueue → waitQueue 顺序，跳过已阵亡单位在各队列里的残留 id，
 * 并为每条目标注所属段（done / normal / wait）。
 * 跨回合重排由 battleReducer.advance() 负责（normalQueue 已按剩余部队当前速度重建），本函数只做投影。
 */
import type { UnitDefId } from '../../data/units'
import type { BattleState, BattleUnit } from './types'

export interface TurnOrderEntry {
  unitId: string
  side: BattleUnit['side']
  defId: UnitDefId
  hasActed: boolean
  segment: 'done' | 'normal' | 'wait'
}

export function buildTurnOrderQueue(
  state: Pick<BattleState, 'completedQueue' | 'normalQueue' | 'waitQueue' | 'units'>
): TurnOrderEntry[] {
  const byId = new Map(state.units.map((u) => [u.id, u]))
  const order = [...state.completedQueue, ...state.normalQueue, ...state.waitQueue]
  const entries: TurnOrderEntry[] = []
  for (const id of order) {
    const unit = byId.get(id)
    if (!unit) continue
    const segment = state.completedQueue.includes(id) ? 'done' : state.waitQueue.includes(id) ? 'wait' : 'normal'
    entries.push({ unitId: unit.id, side: unit.side, defId: unit.defId, hasActed: unit.hasActed, segment })
  }
  return entries
}
