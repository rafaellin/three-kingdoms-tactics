import { describe, expect, test } from 'vitest'
import { hexKey, type Axial } from '../hex/HexGrid'
import { generateMap } from '../map/MapGen'
import type { TerrainId } from '../../data/terrain'
import { computeVision, isExplored, type FogMap, type VisionSource } from './Fog'

/** 全平地地图（可覆盖指定 hex 地形） */
function plainMap(radius: number, overrides: Record<string, TerrainId> = {}): {
  hexes: Axial[]
  terrain: Record<string, TerrainId>
} {
  const { hexes } = generateMap(1, radius)
  const terrain: Record<string, TerrainId> = {}
  for (const h of hexes) terrain[hexKey(h)] = 'plain'
  for (const [k, v] of Object.entries(overrides)) terrain[k] = v
  return { hexes, terrain }
}

function vision(sources: VisionSource[], map: { hexes: Axial[]; terrain: Record<string, TerrainId> }, oldFog: FogMap = {}): FogMap {
  return computeVision({
    sources,
    mapHexes: map.hexes,
    terrainAt: (h) => map.terrain[hexKey(h)] ?? 'plain',
    oldFog
  })
}

const count = (fog: FogMap, state: 'explored' | 'unexplored'): number =>
  Object.values(fog).filter((v) => v === state).length

const hero = (position: Axial, sightRange: number): VisionSource => ({ position, sightRange })

describe('computeVision 视野计算（两态：explored 已探索 / unexplored 未探索）', () => {
  test('无阻挡、视野半径 3：地图恰好半径 3 时全部已探索', () => {
    const map = plainMap(3)
    const fog = vision([hero({ q: 0, r: 0 }, 3)], map)
    expect(count(fog, 'explored')).toBe(37) // 1 + 6 + 12 + 18
    expect(count(fog, 'unexplored')).toBe(0)
  })

  test('视野半径 3、地图半径 5：37 已探索，其余未探索', () => {
    const map = plainMap(5)
    const fog = vision([hero({ q: 0, r: 0 }, 3)], map)
    expect(count(fog, 'explored')).toBe(37)
    expect(count(fog, 'unexplored')).toBe(91 - 37) // 半径5 = 91 格
  })

  test('已探索永久化：走出视野后仍保持 explored，未探索不会回退', () => {
    const map = plainMap(5)
    const first = vision([hero({ q: 0, r: 0 }, 3)], map)
    const moved = vision([hero({ q: 4, r: 0 }, 3)], map, first)
    // 曾见格退出视野后仍是 explored（永久可见）
    expect(moved[hexKey({ q: 0, r: 0 }) as string]).toBe('explored')
    // 新位置附近 → 新揭开为 explored
    expect(moved[hexKey({ q: 4, r: 0 }) as string]).toBe('explored')
    // 从未被看到过的远处格子仍是 unexplored（探索不可逆）
    expect(moved[hexKey({ q: -4, r: 0 }) as string]).toBe('unexplored')
    expect(count(moved, 'unexplored')).toBeGreaterThan(0)
    expect(count(moved, 'explored') + count(moved, 'unexplored')).toBe(91)
  })

  test('山脉阻挡视线：两格厚墙背后的格子不可见', () => {
    // 单格阻挡可被绕行（绕路仍在视野内）；两格厚墙使最短绕路 = 4 > 视野 3
    const map = plainMap(3, { [hexKey({ q: 1, r: 0 })]: 'mountain', [hexKey({ q: 2, r: 0 })]: 'mountain' })
    const fog = vision([hero({ q: 0, r: 0 }, 3)], map)
    expect(fog[hexKey({ q: 1, r: 0 }) as string]).toBe('explored') // 阻挡格本身可见
    expect(fog[hexKey({ q: 2, r: 0 }) as string]).toBe('explored')
    expect(fog[hexKey({ q: 3, r: 0 }) as string]).toBe('unexplored') // 墙后看不到
    expect(fog[hexKey({ q: 0, r: -1 }) as string]).toBe('explored') // 侧面不受影响
  })

  test('河流阻挡视线：与山脉同理', () => {
    const map = plainMap(3, { [hexKey({ q: 1, r: 0 })]: 'water', [hexKey({ q: 2, r: 0 })]: 'water' })
    const fog = vision([hero({ q: 0, r: 0 }, 3)], map)
    expect(fog[hexKey({ q: 1, r: 0 }) as string]).toBe('explored')
    expect(fog[hexKey({ q: 2, r: 0 }) as string]).toBe('explored')
    expect(fog[hexKey({ q: 3, r: 0 }) as string]).toBe('unexplored')
  })

  test('isExplored：仅已探索格可通行，未探索 / 无记录不可', () => {
    const fog: FogMap = {
      [hexKey({ q: 0, r: 1 })]: 'explored',
      [hexKey({ q: 1, r: 0 })]: 'unexplored'
    }
    expect(isExplored(fog, { q: 0, r: 1 })).toBe(true)
    expect(isExplored(fog, { q: 1, r: 0 })).toBe(false)
    expect(isExplored(fog, { q: 9, r: 9 })).toBe(false)
  })
})
