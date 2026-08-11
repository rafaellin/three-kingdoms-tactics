/**
 * 战斗测试固定阵容（纯数据）：主菜单「战斗测试」入口用。
 * 我方：关羽（武力90/统御70）+ 4 支；敌方：吕布（武力100/统御80）+ 3 支。
 * atkBonus = round(武力/3)，defBonus = round(统御/3)。
 */
import type { BattleArmyConfig } from '../core/battle/types'

export const BATTLE_GRID = { cols: 13, rows: 9 } as const

export const PLAYER_ARMY: BattleArmyConfig = {
  side: 'player',
  generalName: '关羽',
  atkBonus: 30,   // 90/3
  defBonus: 23,   // 70/3 ≈ 23.3
  units: [
    { defId: 'militia', count: 30 },
    { defId: 'swordsman', count: 12 },
    { defId: 'archer', count: 10 },
    { defId: 'cavalry', count: 8 }   // 骑兵 → 验证 1×2 支持
  ]
}

export const ENEMY_ARMY: BattleArmyConfig = {
  side: 'enemy',
  generalName: '吕布',
  atkBonus: 33,   // 100/3 ≈ 33.3
  defBonus: 27,   // 80/3 ≈ 26.7
  units: [
    { defId: 'militia', count: 20 },
    { defId: 'pikeman', count: 12 },
    { defId: 'archer', count: 8 }
  ]
}
