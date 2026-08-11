/**
 * 战斗 reducer：纯函数，经独立 CommandLog 驱动 BattleState。
 * 相同命令序列 + 相同初始状态 ⇒ 相同终态（确定性）。MVP 无随机。
 * 命令：battle/init | battle/select | battle/move | battle/attack | battle/endTurn | battle/surrender
 */
import { type Command, type Reducer } from '../events/CommandLog'
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { computeDamage } from './damage'
import { battleFindPath, battleReachableArea } from './pathing'
import { occupiedHexes, type BattleArmyConfig, type BattleState, type BattleUnit } from './types'

export function createInitialBattleState(): BattleState {
  return {
    grid: { cols: 0, rows: 0 },
    units: [],
    general: {
      player: { name: '', atkBonus: 0, defBonus: 0 },
      enemy: { name: '', atkBonus: 0, defBonus: 0 }
    },
    turn: 1,
    order: [],
    currentUnitId: null,
    selectedUnitId: null,
    phase: 'combat',
    log: []
  }
}

function sortOrder(units: BattleUnit[]): string[] {
  return [...units]
    .sort((a, b) => {
      const sp = UNIT_DEFS[b.defId].speed - UNIT_DEFS[a.defId].speed
      if (sp !== 0) return sp
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((u) => u.id)
}

function init(state: BattleState, payload: { player: BattleArmyConfig; enemy: BattleArmyConfig; grid: { cols: number; rows: number } }): BattleState {
  const mk = (cfg: BattleArmyConfig, qBase: number): BattleUnit[] =>
    cfg.units.map((u, i) => {
      const def = UNIT_DEFS[u.defId]
      return {
        id: `${cfg.side === 'player' ? 'p' : 'e'}${i}`,
        side: cfg.side,
        defId: u.defId,
        count: u.count,
        position: { q: qBase, r: i },
        size: def.size,
        hpLeft: u.count * def.hp,
        maxHp: u.count * def.hp,
        hasActed: false,
        hasMoved: false
      }
    })
  const units = [...mk(payload.player, 0), ...mk(payload.enemy, payload.grid.cols - 2)]
  const order = sortOrder(units)
  return {
    ...state,
    grid: payload.grid,
    units,
    general: {
      player: { name: payload.player.generalName, atkBonus: payload.player.atkBonus, defBonus: payload.player.defBonus },
      enemy: { name: payload.enemy.generalName, atkBonus: payload.enemy.atkBonus, defBonus: payload.enemy.defBonus }
    },
    turn: 1,
    order,
    currentUnitId: order[0] ?? null,
    selectedUnitId: null,
    phase: 'combat',
    log: [`战斗开始：${payload.player.generalName} vs ${payload.enemy.generalName}`]
  }
}

/** 找到本回合下一个未行动单位；全部行动完则 turn+1、重置、按新状态重排 */
function advance(state: BattleState): BattleState {
  for (const id of state.order) {
    const u = state.units.find((x) => x.id === id)
    if (u && !u.hasActed) return { ...state, currentUnitId: id, selectedUnitId: null }
  }
  const units = state.units.map((u) => ({ ...u, hasActed: false, hasMoved: false }))
  const order = sortOrder(units)
  return { ...state, turn: state.turn + 1, units, order, currentUnitId: order[0] ?? null, selectedUnitId: null }
}

function endTurn(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId) return state
  const units = state.units.map((u) => (u.id === unit.id ? { ...u, hasActed: true } : u))
  return advance({ ...state, units })
}

/** 判定胜负：一方全灭 */
function phaseOf(units: BattleUnit[]): BattleState['phase'] {
  if (!units.some((u) => u.side === 'player')) return 'lost'
  if (!units.some((u) => u.side === 'enemy')) return 'won'
  return 'combat'
}

function select(state: BattleState, unitId: string | null): BattleState {
  if (unitId === null) return { ...state, selectedUnitId: null }
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.side !== 'player') return state
  return { ...state, selectedUnitId: unit.id }
}

function move(state: BattleState, unitId: string, to: Axial): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || unit.hasActed || unit.hasMoved) return state
  if (hexKey(unit.position) === hexKey(to)) return state
  const reachable = battleReachableArea(unit, state)
  if (!reachable.some((h) => hexKey(h) === hexKey(to))) return state
  if (!battleFindPath(unit, to, state)) return state
  return {
    ...state,
    units: state.units.map((u) => (u.id === unitId ? { ...u, position: { ...to }, hasMoved: true } : u))
  }
}

function attack(state: BattleState, unitId: string, targetId: string): BattleState {
  const attacker = state.units.find((u) => u.id === unitId)
  const target = state.units.find((u) => u.id === targetId)
  if (!attacker || !target || attacker.id !== state.currentUnitId || attacker.hasActed) return state
  if (attacker.side === target.side) return state
  const range = UNIT_DEFS[attacker.defId].range
  const inRange = occupiedHexes(target).some((h) => hexDistance(attacker.position, h) <= range)
  if (!inRange) return state
  const general = state.general[attacker.side]
  const dmg = computeDamage(attacker, target, general.atkBonus, general.defBonus)
  let units = state.units.map((u) => (u.id === attacker.id ? { ...u, hasActed: true } : u))
  const hpLeft = target.hpLeft - dmg
  if (hpLeft <= 0) {
    units = units.filter((u) => u.id !== target.id)
  } else {
    units = units.map((u) =>
      u.id === target.id ? { ...u, hpLeft, count: Math.max(1, Math.ceil(hpLeft / UNIT_DEFS[u.defId].hp)) } : u
    )
  }
  const phase = phaseOf(units)
  const log = [...state.log, `${attacker.id} 攻击 ${target.id} 造成 ${dmg} 伤害${hpLeft <= 0 ? '（消灭）' : ''}`]
  if (phase !== 'combat') return { ...state, units, phase, log }
  return advance({ ...state, units, log })
}

export const battleReducer: Reducer<BattleState> = (state, cmd: Command) => {
  switch (cmd.type) {
    case 'battle/init':
      return init(state, cmd.payload as Parameters<typeof init>[1])
    case 'battle/select': {
      const payload = cmd.payload as { unitId: string | null }
      return select(state, payload.unitId)
    }
    case 'battle/move': {
      const payload = cmd.payload as { unitId: string; to: Axial }
      return move(state, payload.unitId, payload.to)
    }
    case 'battle/attack': {
      const payload = cmd.payload as { unitId: string; targetId: string }
      return attack(state, payload.unitId, payload.targetId)
    }
    case 'battle/endTurn':
      return endTurn(state, (cmd.payload as { unitId: string }).unitId)
    case 'battle/surrender':
      return { ...state, phase: 'lost', log: [...state.log, '投降'] }
    default:
      return state
  }
}
