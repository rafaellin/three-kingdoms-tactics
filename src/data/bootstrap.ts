/**
 * 新对局启动数据（纯数据，无逻辑）：势力顺序 / 初始资源 / 武将 / 城池 / 英雄。
 * 渲染层（AdventureScene）与测试工具（core/testing/setup）共用同一份，避免重复。
 */
import type { FactionId, General, Resources, Town } from '../core/state/GameState'

/** 回合轮转顺序 */
export const TURN_ORDER: readonly FactionId[] = ['wei', 'shu', 'wu', 'qun']

/** 各势力初始资源 */
export const START_RESOURCES: Record<FactionId, Resources> = {
  wei: { gold: 100, wood: 50, stone: 0, iron: 0 },
  shu: { gold: 80, wood: 20, stone: 10, iron: 5 },
  wu: { gold: 60, wood: 30, stone: 20, iron: 10 },
  qun: { gold: 40, wood: 10, stone: 5, iron: 0 }
}

/** setup payload 需要的 factions 数组（与资源表保持一致） */
export const START_FACTIONS: readonly { id: FactionId; resources: Resources }[] = [
  { id: 'wei', resources: START_RESOURCES.wei },
  { id: 'shu', resources: START_RESOURCES.shu },
  { id: 'wu', resources: START_RESOURCES.wu },
  { id: 'qun', resources: START_RESOURCES.qun }
]

/** 初始武将池（P0：先放主角关羽） */
export const START_GENERALS: readonly General[] = [
  { id: 'g-guan', name: '关羽', faction: 'shu', type: '全能', level: 1, xp: 0 }
]

/** 初始城池（P0：蜀占成都，位于地图中心 = 英雄出生点） */
export const START_TOWNS: readonly Town[] = [
  { id: 't-chengdu', name: '成都', owner: 'shu', level: 1, garrisonGeneralId: 'g-guan', position: { q: 0, r: 0 } }
]

/** 英雄出生点（地图中心） */
export const HERO_START = { q: 0, r: 0 } as const
export const HERO_GENERAL_ID = 'g-guan'
export const HERO_FACTION: FactionId = 'shu'
