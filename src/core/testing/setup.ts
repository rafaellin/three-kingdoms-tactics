/**
 * 测试工具：标准 setup payload 构造器。
 * 仅测试使用，不属于游戏逻辑；启动数据来自 data/bootstrap（与渲染层同源）。
 */
import type { SetupPayload } from '../state/reducer'
import type { FactionId } from '../state/GameState'
import { makePlainMap } from './maps'
import {
  HERO_FACTION,
  HERO_GENERAL_ID,
  HERO_START,
  START_FACTIONS,
  START_GENERALS,
  START_TOWNS,
  TURN_ORDER
} from '../../data/bootstrap'

/** 标准开局：魏蜀吴群 + 蜀主将（关羽）在 (0,0)，半径 3 全平地地图 */
export function makeSetup(overrides: Partial<SetupPayload> = {}): SetupPayload {
  return {
    turnOrder: [...TURN_ORDER],
    factions: START_FACTIONS.map((f) => ({ id: f.id as FactionId, resources: { ...f.resources } })),
    generals: START_GENERALS.map((g) => ({ ...g })),
    towns: START_TOWNS.map((t) => ({ ...t })),
    map: makePlainMap(3),
    mapSeed: 1,
    heroStart: HERO_START,
    heroGeneralId: HERO_GENERAL_ID,
    heroFaction: HERO_FACTION,
    ...overrides
  }
}
