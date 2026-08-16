/**
 * 武将基础配置（纯数据，无逻辑）。
 * 「当前属性值」由 core/generals.ts 的 deriveStats 双锚点插值推导，本表只存两个锚点：
 * - base：初始六维（Lv1，低起步；名将略高、杂鱼低）
 * - lv20：20 级目标六维（锚点，满成长校准值；20 级后斜率不变继续线性）
 * 六维数值为占位平衡值；吕布不在开局武将池，仅 battleTest 用。
 */
import type { FactionId } from '../core/state/GameState'

export interface GeneralBase {
  id: string
  name: string
  faction: FactionId
  type: '战将' | '智将' | '全能'
  /** 初始六维（Lv1，低值；名将略高、杂鱼低） */
  base: { atk: number; def: number; int: number; pol: number; cha: number }
  /** 20 级目标六维（锚点，满成长校准值） */
  lv20: { atk: number; def: number; int: number; pol: number; cha: number }
  /** 预设被动技能（展示用；效果待技能系统） */
  passives: { name: string; level: number }[]
}

export const GENERAL_BASES: Record<'g-guan' | 'g-lvbu', GeneralBase> = {
  'g-guan': {
    id: 'g-guan', name: '关羽', faction: 'shu', type: '全能',
    base: { atk: 18, def: 16, int: 14, pol: 18, cha: 22 },
    lv20: { atk: 96, def: 70, int: 50, pol: 60, cha: 80 },
    passives: [{ name: '铁壁', level: 1 }]
  },
  'g-lvbu': {
    id: 'g-lvbu', name: '吕布', faction: 'qun', type: '战将',
    base: { atk: 20, def: 18, int: 10, pol: 8, cha: 12 },
    lv20: { atk: 100, def: 80, int: 30, pol: 20, cha: 40 },
    passives: [{ name: '狂暴', level: 1 }]
  }
}
