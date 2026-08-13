/**
 * 战斗内寻路（纯函数，确定性）。
 * 战场为矩形六角窗口（左右锯齿边）；障碍 = 其它单位占据格（含 1×2 双格）+ 战场障碍物 obstacles。
 * 移动力 = 兵种 speed；1×2 单位每一步校验「主体格 + 东邻格」都可通行。
 */
import { hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import { findPath, reachableArea, type MovementCost } from '../pathfinding/Pathfinding'
import { UNIT_DEFS } from '../../data/units'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

/** 矩形窗口谓词：行 r 的 q ∈ [qMin(r), qMin(r)+cols-1]，qMin(r) = -floor(r/2)（左右锯齿边） */
export function inBattleGrid(state: BattleState, hex: Axial): boolean {
  if (hex.r < 0 || hex.r >= state.grid.rows) return false
  const qMin = -Math.floor(hex.r / 2)
  return hex.q >= qMin && hex.q <= qMin + state.grid.cols - 1
}

/** 该单位能否把主体格放到 to：窗口内 + 非障碍 + 不与其它单位重叠（size=2 校验主体+东邻） */
export function canStandAt(mover: BattleUnit, state: BattleState, to: Axial): boolean {
  if (!inBattleGrid(state, to)) return false
  for (const hex of occupiedHexes({ position: to, size: mover.size })) {
    if (!inBattleGrid(state, hex)) return false
    if (state.obstacles.some((o) => hexKey(o) === hexKey(hex))) return false
    for (const other of state.units) {
      if (other.id === mover.id) continue
      if (occupiedHexes(other).some((h) => hexKey(h) === hexKey(hex))) return false
    }
  }
  return true
}

/** 连通性不变量：从 (0,0) 泛洪，所有「窗口内非障碍格」都应可达 → 无孤岛 */
export function battleGridConnected(state: BattleState): boolean {
  const valid = new Set<string>()
  let total = 0
  for (let r = 0; r < state.grid.rows; r++) {
    const qMin = -Math.floor(r / 2)
    for (let q = qMin; q <= qMin + state.grid.cols - 1; q++) {
      const hex = { q, r }
      if (state.obstacles.some((o) => hexKey(o) === hexKey(hex))) continue
      valid.add(hexKey(hex))
      total++
    }
  }
  const startKey = hexKey({ q: 0, r: 0 })
  if (!valid.has(startKey)) return total === 0
  const seen = new Set<string>([startKey])
  const stack: Axial[] = [{ q: 0, r: 0 }]
  let reached = 0
  while (stack.length > 0) {
    const cur = stack.pop() as Axial
    reached++
    for (let d = 0; d < 6; d++) {
      const nb = hexNeighbor(cur, d as HexDir)
      const k = hexKey(nb)
      if (valid.has(k) && !seen.has(k)) {
        seen.add(k)
        stack.push(nb)
      }
    }
  }
  return reached === total
}

export function battleMovementCost(mover: BattleUnit, state: BattleState): MovementCost {
  return {
    cost(_from, to) {
      return canStandAt(mover, state, to) ? 1 : Number.POSITIVE_INFINITY
    }
  }
}

export function battleReachableArea(mover: BattleUnit, state: BattleState): Axial[] {
  return reachableArea(mover.position, mover.speed ?? UNIT_DEFS[mover.defId].speed, battleMovementCost(mover, state))
}

export function battleFindPath(mover: BattleUnit, to: Axial, state: BattleState): Axial[] | null {
  return findPath(mover.position, to, battleMovementCost(mover, state))
}
