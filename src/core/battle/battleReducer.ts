/**
 * 战斗 reducer：纯函数，经独立 CommandLog 驱动 BattleState。
 * 相同命令序列 + 相同初始状态 ⇒ 相同终态（确定性）。MVP 无随机。
 * 命令：battle/init | battle/select | battle/move | battle/attack | battle/shoot | battle/endTurn | battle/wait | battle/defend | battle/surrender | battle/flee | battle/negotiate | battle/retaliate | battle/advance | battle/speedMod
 */
import { type Command, type Reducer } from '../events/CommandLog'
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { computeDamage, DEFEND_BONUS, MELEE_ATTACK_MULT, RANGE_OUT_MULT } from './damage'
import { battleFindPath, battleReachableArea } from './pathing'
import { computeBail } from './result'
import { effectiveSpeed, occupiedHexes, type BattleArmyConfig, type BattleState, type BattleUnit } from './types'
import { maxUnits } from '../growth'

/** 魔法值上限系数：maxMana = round(智力 × MANA_COEF)（PRD §5.3：智力×系数；系数暂定 1） */
const MANA_COEF = 1

/** 进入战斗的武将信息 → 战斗武将态（六维/蓝量/被动；攻防加成从当前武力/统御推导） */
function buildGeneral(cfg: BattleArmyConfig): BattleState['general']['player'] {
  if (cfg.general) {
    const atkBonus = Math.round(cfg.general.stats.atk / 3)
    const defBonus = Math.round(cfg.general.stats.def / 3)
    const maxMana = Math.round(cfg.general.stats.int * MANA_COEF)
    return {
      name: cfg.general.name,
      atkBonus,
      defBonus,
      stats: { ...cfg.general.stats },
      level: cfg.general.level,
      maxMana,
      currentMana: maxMana,
      passives: cfg.general.passives.map((p) => ({ ...p }))
    }
  }
  // 无 general：旧字段反推展示值（现有测试/e2e 阵容行为不变）。
  // 注意：stats 是近似值（atk = atkBonus×3 会丢失原始四舍五入，如 atkBonus 33 → 武力 99 而非 100），
  // 仅用于六维展示，不参与战斗伤害结算（伤害走 atkBonus/defBonus，见 computeDamage）。
  const atkBonus = cfg.atkBonus ?? 0
  const defBonus = cfg.defBonus ?? 0
  return {
    name: cfg.generalName ?? '未知',
    atkBonus,
    defBonus,
    stats: { atk: atkBonus * 3, def: defBonus * 3, int: 0, pol: 0, cha: 0 },
    level: 1,
    maxMana: 0,
    currentMana: 0,
    passives: []
  }
}

/** 标准化 log 单位名：`武将的兵种`（如「关羽的骑兵」） */
function unitName(state: BattleState, unit: Pick<BattleUnit, 'side' | 'defId'>): string {
  return `${state.general[unit.side].name}的${UNIT_DEFS[unit.defId].name}`
}

export function createInitialBattleState(): BattleState {
  return {
    grid: { cols: 0, rows: 0 },
    obstacles: [],
    units: [],
    general: {
      player: { name: '', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] },
      enemy: { name: '', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] }
    },
    turn: 1,
    completedQueue: [],
    normalQueue: [],
    waitQueue: [],
    currentUnitId: null,
    selectedUnitId: null,
    phase: 'combat',
    outcome: null,
    killedHp: { player: 0, enemy: 0 },
    log: []
  }
}

/** 速度比较（降序）：有效速度 → 同速攻方（玩家）先行 → id 稳定序 */
function compareUnits(a: BattleUnit, b: BattleUnit): number {
  const sp = effectiveSpeed(b) - effectiveSpeed(a)
  if (sp !== 0) return sp
  if (a.side !== b.side) return a.side === 'player' ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function sortOrder(units: BattleUnit[]): string[] {
  return [...units].sort(compareUnits).map((u) => u.id)
}

/** 中途速度变化后重排 normalQueue：保留当前单位及之前段，之后剔除阵亡按 effectiveSpeed 降序重排 */
function reorderNormal(state: BattleState): string[] {
  const curIdx = state.normalQueue.indexOf(state.currentUnitId ?? '')
  if (curIdx < 0) return state.normalQueue
  const alive = new Set(state.units.map((u) => u.id))
  const prefix = state.normalQueue.slice(0, curIdx + 1)
  const tail = state.normalQueue
    .slice(curIdx + 1)
    .filter((id) => alive.has(id))
    .sort((aId, bId) => {
      const a = state.units.find((u) => u.id === aId) as BattleUnit
      const b = state.units.find((u) => u.id === bId) as BattleUnit
      return compareUnits(a, b)
    })
  return [...prefix, ...tail]
}

/** 重排 waitQueue：保留 prefix（当前单位及之前）不动，之后剔除阵亡按升序（tailAsc=true）重排 */
function reorderWait(state: BattleState, tailAsc: boolean): string[] {
  const curIdx = state.waitQueue.indexOf(state.currentUnitId ?? '')
  const alive = new Set(state.units.map((u) => u.id))
  const tail = (curIdx >= 0 ? state.waitQueue.slice(curIdx + 1) : state.waitQueue).filter((id) => alive.has(id))
  tail.sort((aId, bId) => {
    const a = state.units.find((u) => u.id === aId) as BattleUnit
    const b = state.units.find((u) => u.id === bId) as BattleUnit
    return tailAsc ? compareUnits(b, a) : compareUnits(a, b)
  })
  return curIdx >= 0 ? [...state.waitQueue.slice(0, curIdx + 1), ...tail] : tail
}

function init(state: BattleState, payload: { player: BattleArmyConfig; enemy: BattleArmyConfig; grid: { cols: number; rows: number; obstacles?: Axial[] }; playerGold?: number; opponentKind?: 'faction' | 'wild' }): BattleState {
  const mk = (cfg: BattleArmyConfig, qBase: number): BattleUnit[] => {
    // 部队数上限校验（HOMM3 式槽位）：超限截断到 maxUnits(武将等级，缺省 Lv1=4)，保留前 N 支（确定性）
    const cap = maxUnits(cfg.general?.level ?? 1)
    return cfg.units.slice(0, cap).map((u, i) => {
      const def = UNIT_DEFS[u.defId]
      return {
        id: `${cfg.side === 'player' ? 'p' : 'e'}${i}`,
        side: cfg.side,
        defId: u.defId,
        speed: u.speed,
        count: u.count,
        position: u.position ?? { q: qBase, r: i },
        size: def.size,
        hpLeft: u.count * def.hp,
        maxHp: u.count * def.hp,
        hasActed: false,
        hasMoved: false,
        retaliated: false
      }
    })
  }
  const units = [...mk(payload.player, 0), ...mk(payload.enemy, payload.grid.cols - 2)]
  const order = sortOrder(units)
  const general = {
    player: buildGeneral(payload.player),
    enemy: buildGeneral(payload.enemy)
  }
  return {
    ...state,
    grid: payload.grid,
    obstacles: payload.grid.obstacles ?? [],
    units,
    general,
    turn: 1,
    completedQueue: [],
    normalQueue: order,
    waitQueue: [],
    currentUnitId: order[0] ?? null,
    selectedUnitId: null,
    phase: 'combat',
    outcome: null,
    killedHp: { player: 0, enemy: 0 }, // 新开一场战斗清零累计
    enter: payload.playerGold !== undefined && payload.opponentKind !== undefined
      ? { playerGold: payload.playerGold, opponentKind: payload.opponentKind }
      : undefined,
    log: [`战斗开始：${general.player.name} vs ${general.enemy.name}`]
  }
}

/** 扫 normalQueue → waitQueue，返回第一个存活（仍在 units 中）且未行动的未行动单位 */
function nextUnactedId(state: BattleState): string | null {
  const byId = new Map(state.units.map((u) => [u.id, u] as const))
  for (const id of [...state.normalQueue, ...state.waitQueue]) {
    const unit = byId.get(id)
    if (unit && !unit.hasActed) return id
  }
  return null
}

/** 单位完成行动：置 hasActed（+extra），从其所在队列移入 completedQueue */
function markActed(state: BattleState, unitId: string, extra?: Partial<BattleUnit>): BattleState {
  const inWait = state.waitQueue.includes(unitId)
  const units = state.units.map((u) => (u.id === unitId ? { ...u, hasActed: true, defending: false, ...extra } : u))
  return {
    ...state,
    units,
    normalQueue: inWait ? state.normalQueue : state.normalQueue.filter((id) => id !== unitId),
    waitQueue: inWait ? state.waitQueue.filter((id) => id !== unitId) : state.waitQueue,
    completedQueue: state.completedQueue.includes(unitId) ? state.completedQueue : [...state.completedQueue, unitId]
  }
}

/** 判定终态（一方全灭 → 置 phase + outcome）；未终态原样返回 */
function applyTerminal(state: BattleState): BattleState {
  const playerAlive = state.units.some((u) => u.side === 'player')
  const enemyAlive = state.units.some((u) => u.side === 'enemy')
  if (playerAlive && enemyAlive) return state
  const won = !enemyAlive
  return { ...state, phase: won ? 'won' : 'lost', outcome: won ? 'won' : 'lost' }
}

/** 推进：下一未行动单位；全部行动完则 turn+1、重置（含 retaliated）、按新状态重建 normalQueue */
function advance(state: BattleState): BattleState {
  const next = nextUnactedId(state)
  if (next) return { ...state, currentUnitId: next, selectedUnitId: null }
  const units = state.units.map((u) => ({ ...u, hasActed: false, hasMoved: false, retaliated: false }))
  const normalQueue = sortOrder(units)
  return {
    ...state,
    turn: state.turn + 1,
    units,
    completedQueue: [],
    normalQueue,
    waitQueue: [],
    currentUnitId: normalQueue[0] ?? null,
    selectedUnitId: null
  }
}

function endTurn(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId) return state
  return advance(markActed(state, unitId))
}

/**
 * 中途速度修正（减速/加速技能入口）：给单位叠加速度修正 → 重排当前单位之后的未行动段。
 * 不改 currentUnitId；speedMod 跨回合保留（下一回合排序自然带上修正）。
 * 受影响单位在 waitQueue：若当前单位也在 waitQueue（等待段正在行动）→ 保留当前，尾部升序；否则整体升序。
 */
function speedMod(state: BattleState, unitId: string, delta: number): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || state.phase !== 'combat') return state
  const newMod = (unit.speedMod ?? 0) + delta
  const units = state.units.map((u) => (u.id === unitId ? { ...u, speedMod: newMod } : u))
  const next = { ...state, units }
  let order = next.normalQueue
  let waitOrder = next.waitQueue
  if (state.waitQueue.includes(unitId)) {
    // 受影响在 waitQueue：若当前单位也在 waitQueue（等待段正在行动）→ 保留当前，尾部升序；否则整体升序
    waitOrder = reorderWait(next, true)
  } else if (state.normalQueue.includes(unitId)) {
    order = reorderNormal(next)
  }
  const log = [
    ...state.log,
    `第${state.turn}回合 ${unitName(state, unit)} 速度${delta >= 0 ? '+' : ''}${delta}（现 ${effectiveSpeed({ ...unit, speedMod: newMod })}）`
  ]
  return { ...next, normalQueue: order, waitQueue: waitOrder, log }
}

/** 等待：当前单位从 normalQueue 移入 waitQueue（升序插入）。已在 waitQueue 则 no-op */
function wait(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || state.phase !== 'combat') return state
  if (state.waitQueue.includes(unitId)) return state
  const waitQueue = [...state.waitQueue, unitId].sort((aId, bId) => {
    const a = state.units.find((u) => u.id === aId) as BattleUnit
    const b = state.units.find((u) => u.id === bId) as BattleUnit
    return compareUnits(b, a) // 升序：慢的在前
  })
  const next = { ...state, normalQueue: state.normalQueue.filter((id) => id !== unitId), waitQueue }
  return advance(next)
}

/** 防御：置 defending=true（+DEFEND_BONUS 防御，下次行动清除），hasActed=true 并 advance */
function defend(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || state.phase !== 'combat') return state
  const next = markActed(state, unitId, { defending: true })
  const log = [...state.log, `第${state.turn}回合 ${unitName(state, unit)} 原地防御（防御 +${DEFEND_BONUS}）`]
  return advance({ ...next, log })
}

/** 逃跑：弃军返回驻城（phase=fled、outcome=fled、部队清零由 buildBattleResult 处理） */
function flee(state: BattleState): BattleState {
  return { ...state, phase: 'fled', outcome: 'fled', log: [...state.log, '逃跑：弃军返回驻城'] }
}

/** 议和：仅 faction 对手且玩家金钱足够支付保释金时可议和；否则拒绝（no-op） */
function negotiate(state: BattleState): BattleState {
  const enter = state.enter
  if (!enter || enter.opponentKind === 'wild') return state
  const bail = computeBail(state)
  if (enter.playerGold < bail) return state
  return { ...state, phase: 'negotiated', outcome: 'negotiated', log: [...state.log, `议和：支付 ${bail} 金钱，保留部队`] }
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
  const next = markActed(state, unitId, { position: { ...to }, hasMoved: true })
  return advance({ ...next, log: [...state.log, `第${state.turn}回合 ${unitName(state, unit)} 移动到 (${to.q},${to.r})`] })
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

/**
 * 近战攻击（主攻段）：to=落点（默认原地）。落点必须可达（或原地）且与目标相邻；远程兵近战按 30% 攻。
 * 只结算主攻伤害，**不 advance、不结算反击**——反击/推进由 `battle/retaliate` / `battle/advance` 分步处理，
 * 保证动画与数据结算一致（便于后续加士气/幸运连击暴击）。
 */
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
  const targetCountBefore = target.count
  let next = markActed(state, unitId, { position: { ...dest }, hasMoved: true })
  next = { ...next, units: dealDamage(next.units, target.id, dmg) }
  const targetAfter = next.units.find((u) => u.id === target.id)
  const killedCount = targetAfter ? targetCountBefore - targetAfter.count : targetCountBefore
  const eliminated = !targetAfter
  // 歼灭整队 → 累计该方歼灭的敌方 hp×count（1 HP = 1 经验，见 buildBattleResult）
  if (eliminated) {
    next = {
      ...next,
      killedHp: {
        ...next.killedHp,
        [attacker.side]: (next.killedHp[attacker.side] ?? 0) + targetCountBefore * UNIT_DEFS[target.defId].hp
      }
    }
  }
  const logs = [
    `第${state.turn}回合 ${unitName(state, attacker)} 攻击 ${unitName(state, target)}，` +
    `造成 ${dmg} 点伤害${killedCount > 0 ? `，歼灭 ${killedCount} 个` : ''}（${eliminated ? '消灭' : '全伤'}）`
  ]
  return applyTerminal({ ...next, log: [...state.log, ...logs] })
}

/** 目标是否能反击攻击者（分段结算的判定）：目标存活、未反击、异侧、按体积相邻 */
export function canRetaliate(state: BattleState, retaliatorId: string, victimId: string): boolean {
  const retaliator = state.units.find((u) => u.id === retaliatorId)
  const victim = state.units.find((u) => u.id === victimId)
  if (!retaliator || !victim || retaliator.retaliated || retaliator.side === victim.side) return false
  return occupiedHexes(retaliator).some((h) => occupiedHexes(victim).some((vh) => hexDistance(h, vh) <= 1))
}

/** 反击段：retaliator 反击 victim（全伤、每回合一次）；结算后 advance */
function retaliate(state: BattleState, retaliatorId: string, victimId: string): BattleState {
  const retaliator = state.units.find((u) => u.id === retaliatorId)
  const victim = state.units.find((u) => u.id === victimId)
  if (!retaliator || !victim || retaliator.retaliated || retaliator.side === victim.side) return state
  if (!occupiedHexes(retaliator).some((h) => occupiedHexes(victim).some((vh) => hexDistance(h, vh) <= 1))) return state
  const defGen = state.general[victim.side]
  const atkGen = state.general[retaliator.side]
  const rMult = UNIT_DEFS[retaliator.defId].range > 1 ? MELEE_ATTACK_MULT : 1
  const rDmg = computeDamage(retaliator, victim, atkGen.atkBonus, defGen.defBonus, rMult)
  const victimCountBefore = victim.count
  let units = state.units.map((u) => (u.id === retaliator.id ? { ...u, retaliated: true } : u))
  units = dealDamage(units, victim.id, rDmg)
  const victimAfter = units.find((u) => u.id === victim.id)
  const killedCount = victimAfter ? victimCountBefore - victimAfter.count : victimCountBefore
  const eliminated = !victimAfter
  // 歼灭整队 → 累计该方歼灭的敌方 hp×count（1 HP = 1 经验，见 buildBattleResult）
  let killedHp = state.killedHp
  if (eliminated) {
    killedHp = {
      ...state.killedHp,
      [retaliator.side]: (state.killedHp[retaliator.side] ?? 0) + victimCountBefore * UNIT_DEFS[victim.defId].hp
    }
  }
  const logs = [
    `第${state.turn}回合 ${unitName(state, retaliator)} 反击 ${unitName(state, victim)}，` +
    `造成 ${rDmg} 点伤害${killedCount > 0 ? `，歼灭 ${killedCount} 个` : ''}（${eliminated ? '消灭' : '全伤'}）`
  ]
  const s = applyTerminal({ ...state, units, killedHp, log: [...state.log, ...logs] })
  if (s.phase !== 'combat') return s
  return advance(s)
}

/** 推进到下一个未行动单位（分段结算时主攻后无反击则调用） */
function advanceTurn(state: BattleState): BattleState {
  return advance(state)
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
  const targetCountBefore = target.count
  let next = markActed(state, unitId, { hasMoved: true })
  next = { ...next, units: dealDamage(next.units, target.id, dmg) }
  const targetAfter = next.units.find((u) => u.id === target.id)
  const killedCount = targetAfter ? targetCountBefore - targetAfter.count : targetCountBefore
  const eliminated = !targetAfter
  // 歼灭整队 → 累计该方歼灭的敌方 hp×count（1 HP = 1 经验，见 buildBattleResult）
  if (eliminated) {
    next = {
      ...next,
      killedHp: {
        ...next.killedHp,
        [attacker.side]: (next.killedHp[attacker.side] ?? 0) + targetCountBefore * UNIT_DEFS[target.defId].hp
      }
    }
  }
  const log = [
    ...state.log,
    `第${state.turn}回合 ${unitName(state, attacker)} 射击 ${unitName(state, target)}，` +
    `造成 ${dmg} 点伤害${killedCount > 0 ? `，歼灭 ${killedCount} 个` : ''}（${eliminated ? '消灭' : inRange ? '满额' : '半额'}）`
  ]
  const s = applyTerminal({ ...next, log })
  if (s.phase !== 'combat') return s
  return advance(s)
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
    case 'battle/wait':
      return wait(state, (cmd.payload as { unitId: string }).unitId)
    case 'battle/defend':
      return defend(state, (cmd.payload as { unitId: string }).unitId)
    case 'battle/speedMod': {
      const payload = cmd.payload as { unitId: string; delta: number }
      return speedMod(state, payload.unitId, payload.delta)
    }
    case 'battle/retaliate': {
      const payload = cmd.payload as { retaliatorId: string; victimId: string }
      return retaliate(state, payload.retaliatorId, payload.victimId)
    }
    case 'battle/advance':
      return advanceTurn(state)
    case 'battle/surrender':
      return { ...state, phase: 'lost', outcome: 'surrendered', log: [...state.log, '投降'] }
    case 'battle/flee':
      return flee(state)
    case 'battle/negotiate':
      return negotiate(state)
    default:
      return state
  }
}
