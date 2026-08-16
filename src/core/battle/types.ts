/**
 * 战斗核心类型（纯数据 + 纯函数，零 Phaser）。
 * 战场为矩形六角窗口（左右锯齿边，行 r 的 q ∈ [-floor(r/2), -floor(r/2)+cols-1]），
 * 窗口内含障碍物（不可通行、不可占）。
 * 1×2 大型单位（骑兵）占据主体格 + 东邻居格 (q+1, r)，不旋转（HOMM3 逻辑）。
 */
import { UNIT_DEFS, type UnitDefId } from '../../data/units'
import type { Axial } from '../hex/HexGrid'
import type { GeneralStats } from '../state/GameState'

export type Side = 'player' | 'enemy'

/** 战斗阶段：combat 进行中；won/lost 自然胜败；fled 逃跑；negotiated 议和 */
export type Phase = 'combat' | 'won' | 'lost' | 'fled' | 'negotiated'

/** 战斗最终结果（探索层据此决定后续；generalCaptured：降=true、逃/和=false、自然=null） */
export type BattleOutcome = 'won' | 'lost' | 'surrendered' | 'fled' | 'negotiated'

/** 进入战斗时的参数（玩家金币 / 对手类型；议和保释金与可议和判定用） */
export interface BattleEnterParams {
  playerGold: number
  opponentKind: 'faction' | 'wild'
}

/** 战斗结算结果（交给探索层：结果 / 剩余部队 / 经验 / 金币结算 / 俘虏） */
export interface BattleResult {
  outcome: BattleOutcome
  remainingTroops: { defId: UnitDefId; count: number }[]
  expGained: number
  goldSettlement: number
  generalCaptured: boolean | null
}

export interface BattleUnit {
  id: string
  side: Side
  defId: UnitDefId
  /** 速度覆盖（可选；缺省用 UNIT_DEFS[defId].speed；测试/配置用） */
  speed?: number
  /** 战斗内速度修正（减速/加速技能入口；跨回合保留，叠加在 speed/兵种速度之上，见 effectiveSpeed） */
  speedMod?: number
  /** 当前 stack 数量（受创后按 命×count 池折算，见 reducer） */
  count: number
  /** 主体格（轴向坐标；size=2 时为左侧格） */
  position: Axial
  size: 1 | 2
  /** 剩余总血量池（= 命×count 累计扣减） */
  hpLeft: number
  maxHp: number
  /** 本回合是否已行动（行动 = 攻击或结束回合） */
  hasActed: boolean
  /** 本回合是否已移动（move 或 attack 均置位；用于阻止移动后远程射击等） */
  hasMoved: boolean
  /** 本回合是否已反击（每回合重置；近战引发，每回合一次） */
  retaliated: boolean
  /** 攻防修正（点数/百分比，来自技能/buff；叠加在武将属性加成之上，见 damage.ts） */
  mods?: { atk?: number; def?: number; atkPct?: number; defPct?: number }
  /** 是否处于防御状态（battle/defend 置位，+DEFEND_BONUS 防御；下次行动清除） */
  defending?: boolean
}

export interface BattleUnitConfig {
  defId: UnitDefId
  count: number
  /** 可选自定义出生格（默认玩家 q=0、敌方 q=cols-2，行=单位索引） */
  position?: Axial
  /** 可选速度覆盖（默认 UNIT_DEFS 值；测试/调试用） */
  speed?: number
}

/** 进入战斗的武将信息（携带当前属性值；战斗不感知基础配置/成长公式） */
export interface BattleGeneralConfig {
  name: string
  level: number
  /** 当前六维（调用方从 General.stats 传入） */
  stats: GeneralStats
  /** 已生效被动技能（展示） */
  passives: { name: string; level: number }[]
}

/** 战斗中一方的武将态（展示 + 攻防/蓝量派生） */
export interface BattleGeneral {
  name: string
  atkBonus: number   // = round(stats.atk/3)
  defBonus: number   // = round(stats.def/3)
  stats: GeneralStats
  level: number
  maxMana: number    // = round(stats.int × MANA_COEF)
  currentMana: number
  passives: { name: string; level: number }[]
}

export interface BattleArmyConfig {
  side: Side
  /** 武将当前属性（缺省时从 generalName/atkBonus/defBonus 反推展示值） */
  general?: BattleGeneralConfig
  generalName?: string
  /** = round(武力/3)，加到此方所有单位实际攻击 */
  atkBonus?: number
  /** = round(统御/3)，加到此方所有单位实际防御 */
  defBonus?: number
  units: BattleUnitConfig[]
}

export interface BattleState {
  grid: { cols: number; rows: number }
  /** 战场障碍物（不可通行、不可占）；init 从配置带入 */
  obstacles: Axial[]
  units: BattleUnit[]
  general: Record<Side, BattleGeneral>
  turn: number
  /** 本回合已完成行动的单位 id（按完成先后追加） */
  completedQueue: string[]
  /** 正常行动队列（effectiveSpeed 降序；队首=下一个行动） */
  normalQueue: string[]
  /** 等待队列（effectiveSpeed 升序；正常队列清空后才行动；队首=最慢） */
  waitQueue: string[]
  currentUnitId: string | null
  /** 渲染层选中（高亮）；e2e 断言用 */
  selectedUnitId: string | null
  phase: Phase
  /** 战斗最终结果（终态/降/逃/和 写入；combat 中为 null） */
  outcome: BattleOutcome | null
  /** 进入战斗时的参数（玩家金币 / 对手类型；battle/init 带入，议和判定用） */
  enter?: BattleEnterParams
  /** 每方累计歼灭的敌方 hp×count（1 HP = 1 经验；被歼灭单位会从 units 移除，故战斗中途累加） */
  killedHp: Record<Side, number>
  log: string[]
}

/** 单位占据的 hex 集合：size=1 → 主体格；size=2 → 主体格 + 东邻 (q+1, r) */
export function occupiedHexes(unit: Pick<BattleUnit, 'position' | 'size'>): Axial[] {
  return unit.size === 2 ? [unit.position, { q: unit.position.q + 1, r: unit.position.r }] : [unit.position]
}

/** 受伤士兵剩余血量：hpLeft - (count-1)×单兵血量 */
export function woundedHp(unit: Pick<BattleUnit, 'hpLeft' | 'count' | 'defId'>): number {
  return unit.hpLeft - (unit.count - 1) * UNIT_DEFS[unit.defId].hp
}

/** 有效速度：配置/兵种速度 + 战斗内修正（speedMod）；回合排序与中途重排统一用它 */
export function effectiveSpeed(unit: Pick<BattleUnit, 'defId' | 'speed' | 'speedMod'>): number {
  return (unit.speed ?? UNIT_DEFS[unit.defId].speed) + (unit.speedMod ?? 0)
}
