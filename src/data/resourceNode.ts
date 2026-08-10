/**
 * 地图设施 / 资源点纯数据表（src/data 约定：纯数据，不含逻辑）。
 * 来源：PRD-SUPPLEMENT §5.2 地图设施（本轮实现 矿 + 宝箱）。
 * 资源仅 4 种：金 / 木 / 石 / 铁（无粮食概念，用户已确认）。
 */
import type { Resources } from '../core/state/GameState'

/** 资源点类型 */
export type ResourceNodeType = 'woodMine' | 'stoneMine' | 'ironMine' | 'chest'

export interface ResourceNodeDef {
  type: ResourceNodeType
  /** 中文名（渲染层 tooltip / 日志用） */
  name: string
  /** 一次性拾取加成（chest）；矿无 */
  oneTime?: Partial<Resources>
  /** 矿的每周产出（仅 mine 有）；占领后每周结算 */
  weeklyBonus?: Partial<Resources>
}

export const RESOURCE_NODE_DEFS: Readonly<Record<ResourceNodeType, ResourceNodeDef>> = {
  woodMine: { type: 'woodMine', name: '伐木场', weeklyBonus: { wood: 10 } },
  stoneMine: { type: 'stoneMine', name: '采石场', weeklyBonus: { stone: 8 } },
  ironMine: { type: 'ironMine', name: '冶铁厂', weeklyBonus: { iron: 6 } },
  // 宝箱固定 30金+5木（PRD 说"随机"，随机化需 RNG 注入，后续接入）
  chest: { type: 'chest', name: '宝箱', oneTime: { gold: 30, wood: 5 } }
}

/** 该类型是否为矿（可占领、每周产出） */
export function isMine(type: ResourceNodeType): boolean {
  return type === 'woodMine' || type === 'stoneMine' || type === 'ironMine'
}

/** 把 Partial<Resources> 补零为完整 Resources（addResources 需完整对象，避免 NaN） */
export function completeResources(p: Partial<Resources> | undefined): Resources {
  return { gold: p?.gold ?? 0, wood: p?.wood ?? 0, stone: p?.stone ?? 0, iron: p?.iron ?? 0 }
}
