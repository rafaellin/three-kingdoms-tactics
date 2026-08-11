/**
 * 战斗核心类型（纯数据 + 纯函数，零 Phaser）。
 * 战场为矩形六角网格（轴向坐标 q∈[0,cols-1]、r∈[0,rows-1]，全平地）。
 * 1×2 大型单位（骑兵）占据主体格 + 东邻居格 (q+1, r)，不旋转（HOMM3 逻辑）。
 */
import type { Axial } from '../hex/HexGrid'

export type Side = 'player' | 'enemy'

export interface BattleUnit {
  id: string
  side: Side
  defId: string
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
  /** 本回合是否已移动（MVP：每回合最多移动一次，移动后可再攻击） */
  hasMoved: boolean
}

export interface BattleArmyConfig {
  side: Side
  generalName: string
  /** = round(武力/3)，加到此方所有单位实际攻击 */
  atkBonus: number
  /** = round(统御/3)，加到此方所有单位实际防御 */
  defBonus: number
  units: { defId: string; count: number }[]
}

export interface BattleState {
  grid: { cols: number; rows: number }
  units: BattleUnit[]
  general: Record<Side, { name: string; atkBonus: number; defBonus: number }>
  turn: number
  /** 本回合按速度降序的 unitId 行动序列 */
  order: string[]
  currentUnitId: string | null
  /** 渲染层选中（高亮）；e2e 断言用 */
  selectedUnitId: string | null
  phase: 'combat' | 'won' | 'lost'
  log: string[]
}

/** 单位占据的 hex 集合：size=1 → 主体格；size=2 → 主体格 + 东邻 (q+1, r) */
export function occupiedHexes(unit: Pick<BattleUnit, 'position' | 'size'>): Axial[] {
  return unit.size === 2 ? [unit.position, { q: unit.position.q + 1, r: unit.position.r }] : [unit.position]
}
