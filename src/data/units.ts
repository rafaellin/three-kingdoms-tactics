/**
 * 兵种属性表（纯数据，无逻辑）。占位值待平衡（PRD §7 未给数值）。
 * 实际攻防 = 基础 + 武将武力/3（见 core/battle/damage.ts）。
 */
export type UnitDefId = 'militia' | 'swordsman' | 'pikeman' | 'archer' | 'cavalry'

export interface UnitDef {
  id: string
  name: string
  /** 格子上显示的文本（1×1 单字、1×2 全名；渲染层直接用，不做字符串截断） */
  gridLabel: string
  attack: number
  defense: number
  minDamage: number
  maxDamage: number
  /** 每回合可移动格数（也作为行动排序依据，越高越先动） */
  speed: number
  /** 单兵生命 */
  hp: number
  cost: { gold: number; wood?: number; stone?: number; iron?: number }
  /** 1=近战（需相邻）；2+=远程（hexDistance ≤ range） */
  range: number
  /** 1=占 1 格；2=占 主体格 + 东邻格（骑兵等大型单位，HOMM3 逻辑） */
  size: 1 | 2
}

export const UNIT_DEFS: Readonly<Record<UnitDefId, UnitDef>> = {
  militia: { id: 'militia', name: '民兵', gridLabel: '民', attack: 4, defense: 4, minDamage: 1, maxDamage: 3, speed: 4, hp: 1, cost: { gold: 50 }, range: 1, size: 1 },
  swordsman: { id: 'swordsman', name: '刀兵', gridLabel: '刀', attack: 6, defense: 8, minDamage: 3, maxDamage: 5, speed: 4, hp: 2, cost: { gold: 100 }, range: 1, size: 1 },
  pikeman: { id: 'pikeman', name: '枪兵', gridLabel: '枪', attack: 7, defense: 6, minDamage: 3, maxDamage: 5, speed: 4, hp: 2, cost: { gold: 100 }, range: 1, size: 1 },
  archer: { id: 'archer', name: '弓兵', gridLabel: '弓', attack: 6, defense: 4, minDamage: 2, maxDamage: 4, speed: 5, hp: 1, cost: { gold: 120 }, range: 6, size: 1 },
  cavalry: { id: 'cavalry', name: '骑兵', gridLabel: '骑兵', attack: 10, defense: 7, minDamage: 5, maxDamage: 8, speed: 9, hp: 3, cost: { gold: 200, iron: 5 }, range: 1, size: 2 }
}
