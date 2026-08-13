import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { battleReachableArea } from './pathing'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

export type EnemyAction =
  | { type: 'attack'; targetId: string; to: Axial }
  | { type: 'shoot'; targetId: string }
  | { type: 'move'; to: Axial }
  | { type: 'endTurn' }

/** 若 mover 可达某与 target 相邻（距离 1）的落点 → 返回距 mover 最近的落点；否则 null */
export function canEngageTarget(mover: BattleUnit, target: BattleUnit, state: BattleState): Axial | null {
  const reachable = battleReachableArea(mover, state)
  let best: Axial | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const hex of reachable) {
    // 1×2：任一体格（主格+东邻）与 target 相邻即算够得着（reducer 按攻击方体积判定命中）
    const body = occupiedHexes({ position: hex, size: mover.size })
    if (!occupiedHexes(target).some((h) => body.some((bh) => hexDistance(bh, h) <= 1))) continue
    const d = hexDistance(mover.position, hex)
    if (d < bestDist) {
      bestDist = d
      best = hex
    }
  }
  return best
}

export function planEnemyAction(state: BattleState): EnemyAction {
  const unit = state.units.find((u) => u.id === state.currentUnitId)
  if (!unit || unit.side !== 'enemy') return { type: 'endTurn' }
  const foes = state.units.filter((u) => u.side !== unit.side)
  if (foes.length === 0) return { type: 'endTurn' }
  const def = UNIT_DEFS[unit.defId]
  const range = def.range
  const pinned = foes.some((f) =>
    occupiedHexes(unit).some((h) => occupiedHexes(f).some((uh) => hexDistance(h, uh) <= 1)))
  // 远程：射程内且未被贴身且未移动 → 射击（优先低血）
  if (range > 1 && !pinned && !unit.hasMoved) {
    const targetable = foes
      .filter((t) => occupiedHexes(t).some((h) => hexDistance(unit.position, h) <= range))
      .sort((a, b) => a.hpLeft - b.hpLeft || (a.id < b.id ? -1 : 1))
    if (targetable.length > 0) return { type: 'shoot', targetId: (targetable[0] as BattleUnit).id }
  }
  // 近战：够得着 → 冲锋（攻击带落点；优先低血）
  const engageable = foes
    .map((f) => ({ foe: f, to: canEngageTarget(unit, f, state) }))
    .filter((x) => x.to !== null) as { foe: BattleUnit; to: Axial }[]
  if (engageable.length > 0) {
    engageable.sort((a, b) => a.foe.hpLeft - b.foe.hpLeft || (a.foe.id < b.foe.id ? -1 : 1))
    const chosen = engageable[0] as { foe: BattleUnit; to: Axial }
    return { type: 'attack', targetId: chosen.foe.id, to: chosen.to }
  }
  // 移动：选可达集中「到最近敌人距离最小」的格（排除自身格，避免原地踏步）
  const reachable = battleReachableArea(unit, state).filter((h) => hexKey(h) !== hexKey(unit.position))
  let best: Axial | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const hex of reachable) {
    let minD = Number.POSITIVE_INFINITY
    for (const t of foes) for (const h of occupiedHexes(t)) minD = Math.min(minD, hexDistance(hex, h))
    if (minD < bestDist) {
      bestDist = minD
      best = hex
    }
  }
  if (best) return { type: 'move', to: best }
  return { type: 'endTurn' }
}
