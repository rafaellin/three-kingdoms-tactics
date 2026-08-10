import { describe, expect, test } from 'vitest'
import { MapMovementCost } from './MapMovementCost'
import { hexKey, type Axial } from '../hex/HexGrid'
import type { TerrainId } from '../../data/terrain'
import type { Visibility } from '../fog/Fog'

/** 测试辅助：地形表 + 迷雾表（hexKey → 迷雾状态）构造代价适配器 */
function makeCost(terrain: Record<string, TerrainId>, fog: Record<string, Visibility>): MapMovementCost {
  return new MapMovementCost({
    terrainAt: (h: Axial) => terrain[hexKey(h)] ?? 'plain',
    fogAt: (h: Axial) => fog[hexKey(h)]
  })
}

const INF = Number.POSITIVE_INFINITY

describe('MapMovementCost：地形 × 迷雾 的寻路代价', () => {
  test('已探索平地代价 1', () => {
    const c = makeCost({}, { '1,0': 'explored' })
    expect(c.cost({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
  })

  test('已探索森林/荒漠代价 1.5，沼泽代价 2', () => {
    const c = makeCost(
      { '1,0': 'forest', '2,0': 'swamp', '3,0': 'desert' },
      { '1,0': 'explored', '2,0': 'explored', '3,0': 'explored' }
    )
    expect(c.cost({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1.5)
    expect(c.cost({ q: 1, r: 0 }, { q: 2, r: 0 })).toBe(2)
    expect(c.cost({ q: 2, r: 0 }, { q: 3, r: 0 })).toBe(1.5)
  })

  test('已探索但不可通行的山脉/河流：代价 Infinity', () => {
    const c = makeCost(
      { '1,0': 'mountain', '2,0': 'water' },
      { '1,0': 'explored', '2,0': 'explored' }
    )
    expect(c.cost({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(INF)
    expect(c.cost({ q: 1, r: 0 }, { q: 2, r: 0 })).toBe(INF)
  })

  test('未探索 / 无记录 一律不可走（迷雾边界：只进已探索格）', () => {
    const c = makeCost({}, { '1,0': 'unexplored' })
    expect(c.cost({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(INF) // unexplored
    expect(c.cost({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(INF) // 迷雾无记录
  })

  test('不可通行地形在无迷雾记录时同样 Infinity（结果一致，不因缺 fog 反而可走）', () => {
    const c = makeCost({ '1,0': 'mountain' }, {})
    expect(c.cost({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(INF)
  })
})
