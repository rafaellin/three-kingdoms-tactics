/**
 * 武将基础配置（纯数据，无逻辑）。
 * 「当前属性值」由 core/generals.ts 的 deriveStats 推导，本表只存静态基础值。
 * 六维数值为占位平衡值；吕布不在开局武将池，仅 battleTest 用。
 */
import type { FactionId } from '../core/state/GameState'

export interface GeneralBase {
  id: string
  name: string
  faction: FactionId
  type: '战将' | '智将' | '全能'
  /** 基础六维（Lv1 基准） */
  baseAtk: number   // 武力
  baseDef: number   // 统御
  baseInt: number   // 智力
  basePol: number   // 政治
  baseCha: number   // 魅力
  /** 每级成长（占位值；PRD §5.2 未给数值，动态成长接缝） */
  growthPerLevel: { atk: number; def: number; int: number; pol: number; cha: number }
  /** 预设被动技能（展示用；效果待技能系统） */
  passives: { name: string; level: number }[]
}

export const GENERAL_BASES: Record<'g-guan' | 'g-lvbu', GeneralBase> = {
  'g-guan': {
    id: 'g-guan', name: '关羽', faction: 'shu', type: '全能',
    baseAtk: 90, baseDef: 70, baseInt: 50, basePol: 60, baseCha: 80,
    growthPerLevel: { atk: 3, def: 2, int: 2, pol: 1, cha: 2 },
    passives: [{ name: '铁壁', level: 1 }]
  },
  'g-lvbu': {
    id: 'g-lvbu', name: '吕布', faction: 'qun', type: '战将',
    baseAtk: 100, baseDef: 80, baseInt: 30, basePol: 20, baseCha: 40,
    growthPerLevel: { atk: 4, def: 2, int: 1, pol: 1, cha: 1 },
    passives: [{ name: '狂暴', level: 1 }]
  }
}
