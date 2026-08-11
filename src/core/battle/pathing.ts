/**
 * 战斗内寻路（纯函数，确定性）。
 * 战场全平地，障碍 = 其它单位占据格（含 1×2 双格）；边界 = grid。
 * 移动力 = 兵种 speed；1×2 单位每一步校验「主体格 + 东邻格」都可通行。
 */
import { hexKey, type Axial } from '../hex/HexGrid'
import { findPath, reachableArea, type MovementCost } from '../pathfinding/Pathfinding'
import { UNIT_DEFS } from '../../data/units'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

function inGrid(state: BattleState, hex: Axial): boolean {
  return hex.q >= 0 && hex.q < state.grid.cols && hex.r >= 0 && hex.r < state.grid.rows
}

/** 该单位能否把主体格放到 to（size=1 校验 1 格；size=2 校验主体+东邻双格） */
function canStandAt(mover: BattleUnit, state: BattleState, to: Axial): boolean {
  if (!inGrid(state, to)) return false
  for (const hex of occupiedHexes({ position: to, size: mover.size })) {
    if (!inGrid(state, hex)) return false
    for (const other of state.units) {
      if (other.id === mover.id) continue
      if (occupiedHexes(other).some((h) => hexKey(h) === hexKey(hex))) return false
    }
  }
  return true
}

export function battleMovementCost(mover: BattleUnit, state: BattleState): MovementCost {
  return {
    cost(_from, to) {
      return canStandAt(mover, state, to) ? 1 : Number.POSITIVE_INFINITY
    }
  }
}

export function battleReachableArea(mover: BattleUnit, state: BattleState): Axial[] {
  return reachableArea(mover.position, UNIT_DEFS[mover.defId].speed, battleMovementCost(mover, state))
}

export function battleFindPath(mover: BattleUnit, to: Axial, state: BattleState): Axial[] | null {
  return findPath(mover.position, to, battleMovementCost(mover, state))
}
