/**
 * 敌方 AI（MVP 简易，纯函数确定性）：① 攻击范围内敌人（优先血低）；
 * ② 否则向最近敌人移动（走可达集中使距离最小的格，排除自身位置）；
 * ③ 都不行则结束回合。
 */
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { battleReachableArea } from './pathing'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

export type EnemyAction = { type: 'attack'; targetId: string } | { type: 'move'; to: Axial } | { type: 'endTurn' }

export function planEnemyAction(state: BattleState): EnemyAction {
  const unit = state.units.find((u) => u.id === state.currentUnitId)
  if (!unit || unit.side !== 'enemy') return { type: 'endTurn' }
  const foes = state.units.filter((u) => u.side !== unit.side)
  if (foes.length === 0) return { type: 'endTurn' }
  const range = UNIT_DEFS[unit.defId].range
  const inRange = (t: BattleUnit): boolean =>
    occupiedHexes(t).some((h) => hexDistance(unit.position, h) <= range)
  const targetable = foes
    .filter(inRange)
    .sort((a, b) => a.hpLeft - b.hpLeft || (a.id < b.id ? -1 : 1))
  if (targetable.length > 0) return { type: 'attack', targetId: (targetable[0] as BattleUnit).id }
  // 移动：选可达集中「到最近敌人距离最小」的格（排除自身格，避免原地踏步死循环）
  const reachable = battleReachableArea(unit, state).filter((h) => hexKey(h) !== hexKey(unit.position))
  let best: Axial | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const hex of reachable) {
    let minD = Number.POSITIVE_INFINITY
    for (const t of foes) {
      for (const h of occupiedHexes(t)) minD = Math.min(minD, hexDistance(hex, h))
    }
    if (minD < bestDist) {
      bestDist = minD
      best = hex
    }
  }
  if (best) return { type: 'move', to: best }
  return { type: 'endTurn' }
}
