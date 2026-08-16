/**
 * 战斗测试固定阵容（纯数据）：主菜单「战斗测试」入口用。
 * 我方：关羽 Lv20（武96/统70/智50/政60/魅80）+ 4 支；敌方：吕布 Lv20（武100/统80/智30/政20/魅40）+ 4 支。
 * 攻防加成由 battleReducer 从当前武力/统御推导（atkBonus = round(武力/3)）。
 */
import type { Axial } from '../core/hex/HexGrid'
import type { BattleArmyConfig } from '../core/battle/types'
import { deriveStats } from '../core/generals'
import { GENERAL_BASES } from './generals'

export const BATTLE_GRID = { cols: 15, rows: 11 } as const

/** 固定测试图障碍：避开出生行/出生格，连通性单测锁定 */
export const BATTLE_OBSTACLES: Axial[] = [
  { q: 4, r: 0 }, { q: 5, r: 0 },
  { q: 4, r: 2 }, { q: 5, r: 2 },
  { q: 7, r: 4 }, { q: 8, r: 4 }
]

const GUAN = GENERAL_BASES['g-guan']
const LVBU = GENERAL_BASES['g-lvbu']

export const PLAYER_ARMY: BattleArmyConfig = {
  side: 'player',
  general: { name: GUAN.name, level: 20, stats: deriveStats(GUAN, 20), passives: [...GUAN.passives] },
  units: [
    { defId: 'militia', count: 30 },
    { defId: 'swordsman', count: 12 },
    { defId: 'archer', count: 10 },
    { defId: 'cavalry', count: 8 }
  ]
}

export const ENEMY_ARMY: BattleArmyConfig = {
  side: 'enemy',
  general: { name: LVBU.name, level: 20, stats: deriveStats(LVBU, 20), passives: [...LVBU.passives] },
  units: [
    { defId: 'militia', count: 20 },
    { defId: 'pikeman', count: 12 },
    { defId: 'archer', count: 8 },
    { defId: 'swordsman', count: 12, position: { q: 5, r: 3 } }
  ]
}
