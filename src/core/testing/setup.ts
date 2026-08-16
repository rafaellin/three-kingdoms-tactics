/**
 * 测试工具：标准 setup payload 构造器。
 * 仅测试使用，不属于游戏逻辑；启动数据来自 data/bootstrap（与渲染层同源）。
 */
import type { SetupPayload } from '../state/reducer'
import { makePlainMap } from './maps'
import { HERO_STARTS, START_GENERALS, START_PLAYERS, START_TOWNS } from '../../data/bootstrap'

/** 标准开局：单玩家 p1（蜀）+ 蜀主将（关羽）在 (0,0)，半径 3 全平地地图 */
export function makeSetup(overrides: Partial<SetupPayload> = {}): SetupPayload {
  return {
    players: START_PLAYERS.map((p) => ({ ...p })),
    generals: START_GENERALS.map((g) => ({ ...g })),
    towns: START_TOWNS.map((t) => ({ ...t })),
    map: makePlainMap(3),
    mapSeed: 1,
    heroStarts: HERO_STARTS.map((h) => ({ generalId: h.generalId, playerId: h.playerId, position: { ...h.position } })),
    ...overrides
  }
}
