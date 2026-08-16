/**
 * 新对局启动数据（纯数据，无逻辑）：玩家序列 / 初始资源 / 武将 / 城池 / 英雄。
 * 渲染层（AdventureScene）与测试工具（core/testing/setup）共用同一份，避免重复。
 */
import { deriveStats } from '../core/generals'
import type { FactionId, General, Player, Resources, Town } from '../core/state/GameState'
import type { Axial } from '../core/hex/HexGrid'
import { GENERAL_BASES } from './generals'

/** 参与回合的玩家序列（顺序 = 轮转顺序）。探索测试 = 单玩家 p1（蜀） */
export const START_PLAYERS: readonly Player[] = [{ id: 'p1', faction: 'shu', kind: 'human' }]

/** 各玩家初始资源，key = PlayerId（同势力玩家各自独立；未参与对局的一律为 0） */
export const START_RESOURCES: Record<string, Resources> = {
  p1: { gold: 80, wood: 20, stone: 10, iron: 5 }
}

/** 初始武将池（P0：先放主角关羽；六维/被动来自基础配置） */
const GUAN = GENERAL_BASES['g-guan']
export const START_GENERALS: readonly General[] = [
  {
    id: GUAN.id,
    name: GUAN.name,
    faction: GUAN.faction,
    type: GUAN.type,
    level: 1,
    xp: 0,
    stats: deriveStats(GUAN, 1),
    skillSlots: Math.floor(1 / 3), // Lv1 → 0
    passives: [...GUAN.passives],
    army: [] // MVP 无初始部队（军制/招募系统未实现）
  }
]

/** 初始城池（P0：蜀占成都，位于地图中心 = 英雄出生点）；owner = PlayerId */
export const START_TOWNS: readonly Town[] = [
  {
    id: 't-chengdu',
    name: '成都',
    owner: 'p1',
    level: 1,
    garrisonGeneralId: 'g-guan',
    garrison: [], // MVP 无城防部队（军制/招募系统未实现）
    visitorGeneralId: null,
    position: { q: 0, r: 0 }
  }
]

/** 英雄出生点（地图中心） */
export const HERO_START = { q: 0, r: 0 } as const
export const HERO_GENERAL_ID = 'g-guan'
export const HERO_FACTION: FactionId = 'shu'

/** 初始英雄列表（多英雄；MVP 单英雄：关羽 @ 成都）；每项带 playerId 归属玩家 */
export const HERO_STARTS: readonly { generalId: string; playerId: string; position: Axial }[] = [
  { generalId: HERO_GENERAL_ID, playerId: 'p1', position: HERO_START }
]
