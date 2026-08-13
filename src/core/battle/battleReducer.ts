/**
 * 战斗 reducer：纯函数，经独立 CommandLog 驱动 BattleState。
 * 相同命令序列 + 相同初始状态 ⇒ 相同终态（确定性）。MVP 无随机。
 * 命令：battle/init | battle/select | battle/move | battle/attack | battle/shoot | battle/endTurn | battle/surrender
 */
import { type Command, type Reducer } from '../events/CommandLog'
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { computeDamage, MELEE_ATTACK_MULT, RANGE_OUT_MULT } from './damage'
import { battleFindPath, battleReachableArea } from './pathing'
import { occupiedHexes, type BattleArmyConfig, type BattleState, type BattleUnit } from './types'

export function createInitialBattleState(): BattleState {
  return {
    grid: { cols: 0, rows: 0 },
    obstacles: [],
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
      // 同速 → 攻方（玩家）先行；仍相同按 id 稳定序
      if (a.side !== b.side) return a.side === 'player' ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((u) => u.id)
}

function init(state: BattleState, payload: { player: BattleArmyConfig; enemy: BattleArmyConfig; grid: { cols: number; rows: number; obstacles?: Axial[] } }): BattleState {
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
        hasMoved: false,
        retaliated: false
      }
    })
  const units = [...mk(payload.player, 0), ...mk(payload.enemy, payload.grid.cols - 2)]
  const order = sortOrder(units)
  return {
    ...state,
    grid: payload.grid,
    obstacles: payload.grid.obstacles ?? [],
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

/** 找到本回合下一个未行动单位；全部行动完则 turn+1、重置（含 retaliated）、按新状态重排 */
function advance(state: BattleState): BattleState {
  for (const id of state.order) {
    const u = state.units.find((x) => x.id === id)
    if (u && !u.hasActed) return { ...state, currentUnitId: id, selectedUnitId: null }
  }
  const units = state.units.map((u) => ({ ...u, hasActed: false, hasMoved: false, retaliated: false }))
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

/** 移动即行动：置 hasActed+hasMoved 并 advance */
function move(state: BattleState, unitId: string, to: Axial): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || unit.hasActed) return state
  if (hexKey(unit.position) === hexKey(to)) return state
  const reachable = battleReachableArea(unit, state)
  if (!reachable.some((h) => hexKey(h) === hexKey(to))) return state
  if (!battleFindPath(unit, to, state)) return state
  const units = state.units.map((u) =>
    u.id === unitId ? { ...u, position: { ...to }, hasActed: true, hasMoved: true } : u
  )
  const log = [...state.log, `${unitId} 移动至 (${to.q},${to.r})`]
  return advance({ ...state, units, log })
}

/** 对 victim 结算 dmg：扣血池 → 折算 count → 死亡则移除。返回更新后的 units */
function dealDamage(units: BattleUnit[], victimId: string, dmg: number): BattleUnit[] {
  const victim = units.find((u) => u.id === victimId)
  if (!victim) return units
  const hpLeft = victim.hpLeft - dmg
  if (hpLeft <= 0) return units.filter((u) => u.id !== victimId)
  return units.map((u) =>
    u.id === victimId ? { ...u, hpLeft, count: Math.max(1, Math.ceil(hpLeft / UNIT_DEFS[u.defId].hp)) } : u
  )
}

/** 近战攻击：to=落点（默认原地）。落点必须可达（或原地）且与目标相邻；远程兵近战按 30% 攻；触发反击（全伤、每回合一次） */
function attack(state: BattleState, unitId: string, targetId: string, to?: Axial): BattleState {
  const attacker = state.units.find((u) => u.id === unitId)
  const target = state.units.find((u) => u.id === targetId)
  if (!attacker || !target || attacker.id !== state.currentUnitId || attacker.hasActed) return state
  if (attacker.side === target.side) return state
  const dest = to ?? attacker.position
  if (hexKey(dest) !== hexKey(attacker.position)) {
    if (!battleReachableArea(attacker, state).some((h) => hexKey(h) === hexKey(dest))) return state
    if (!battleFindPath(attacker, dest, state)) return state
  }
  // 攻击方体积内任一体格与目标相邻即可近战（1×2 骑兵东邻格贴身也算命中）
  const destBody = occupiedHexes({ position: dest, size: attacker.size })
  if (!occupiedHexes(target).some((h) => destBody.some((dh) => hexDistance(dh, h) <= 1))) return state
  const atkGen = state.general[attacker.side]
  const defGen = state.general[target.side]
  const atkMult = UNIT_DEFS[attacker.defId].range > 1 ? MELEE_ATTACK_MULT : 1
  const dmg = computeDamage({ ...attacker, position: dest }, target, atkGen.atkBonus, defGen.defBonus, atkMult)
  let units = state.units.map((u) =>
    u.id === attacker.id ? { ...u, position: { ...dest }, hasActed: true, hasMoved: true } : u
  )
  units = dealDamage(units, target.id, dmg)
  const logs = [`${attacker.id} 攻击 ${target.id} 造成 ${dmg} 伤害${units.some((u) => u.id === target.id) ? '' : '（消灭）'}`]
  const phase = phaseOf(units)
  if (phase !== 'combat') return { ...state, units, phase, log: [...state.log, ...logs] }
  let next = { ...state, units, log: [...state.log, ...logs] }
  // 反击：目标存活、目标本回合未反击、仍在近战范围（落点相邻已保证）
  const targetAfter = units.find((u) => u.id === target.id)
  const attackerAfter = units.find((u) => u.id === attacker.id)
  if (targetAfter && attackerAfter && !targetAfter.retaliated) {
    const rMult = UNIT_DEFS[target.defId].range > 1 ? MELEE_ATTACK_MULT : 1
    const rDmg = computeDamage(targetAfter, attackerAfter, defGen.atkBonus, atkGen.defBonus, rMult)
    let units2 = next.units.map((u) => (u.id === target.id ? { ...u, retaliated: true } : u))
    units2 = dealDamage(units2, attacker.id, rDmg)
    const logs2 = [...logs, `${target.id} 反击 ${attacker.id} 造成 ${rDmg} 伤害${units2.some((u) => u.id === attacker.id) ? '' : '（消灭）'}`]
    const phase2 = phaseOf(units2)
    if (phase2 !== 'combat') return { ...state, units: units2, phase: phase2, log: [...state.log, ...logs2] }
    return advance({ ...next, units: units2, log: [...state.log, ...logs2] })
  }
  return advance(next)
}

/** 远程射击：满额/半额（射程外 ×0.5）；贴身/已移动/非远程 拒绝；不触发反击 */
function shoot(state: BattleState, unitId: string, targetId: string): BattleState {
  const attacker = state.units.find((u) => u.id === unitId)
  const target = state.units.find((u) => u.id === targetId)
  if (!attacker || !target || attacker.id !== state.currentUnitId || attacker.hasActed) return state
  if (attacker.side === target.side) return state
  const def = UNIT_DEFS[attacker.defId]
  if (def.range <= 1 || attacker.hasMoved) return state
  const pinned = state.units.some((u) =>
    u.id !== attacker.id && u.side !== attacker.side &&
    occupiedHexes(attacker).some((h) => occupiedHexes(u).some((uh) => hexDistance(h, uh) <= 1)))
  if (pinned) return state
  const inRange = occupiedHexes(target).some((h) => hexDistance(attacker.position, h) <= def.range)
  const atkGen = state.general[attacker.side]
  const defGen = state.general[target.side]
  const base = computeDamage(attacker, target, atkGen.atkBonus, defGen.defBonus)
  const dmg = Math.round(base * (inRange ? 1 : RANGE_OUT_MULT))
  let units = state.units.map((u) => (u.id === attacker.id ? { ...u, hasActed: true, hasMoved: true } : u))
  units = dealDamage(units, target.id, dmg)
  const dead = !units.some((u) => u.id === target.id)
  const log = [...state.log, `${attacker.id} 射击 ${target.id} 造成 ${dmg} 伤害${inRange ? '' : '（射程外）'}${dead ? '（消灭）' : ''}`]
  const phase = phaseOf(units)
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
      const payload = cmd.payload as { unitId: string; targetId: string; to?: Axial }
      return attack(state, payload.unitId, payload.targetId, payload.to)
    }
    case 'battle/shoot': {
      const payload = cmd.payload as { unitId: string; targetId: string }
      return shoot(state, payload.unitId, payload.targetId)
    }
    case 'battle/endTurn':
      return endTurn(state, (cmd.payload as { unitId: string }).unitId)
    case 'battle/surrender':
      return { ...state, phase: 'lost', log: [...state.log, '投降'] }
    default:
      return state
  }
}
