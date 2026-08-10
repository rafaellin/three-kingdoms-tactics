import { describe, expect, test } from 'vitest'
import { hexKey, hexDistance, type Axial } from '../hex/HexGrid'
import { generateMap } from './MapGen'

describe('generateMap 确定性地图生成', () => {
  test('半径 0：仅中心 1 格', () => {
    const map = generateMap(1, 0)
    expect(map.hexes).toHaveLength(1)
    expect(map.hexes[0]).toEqual({ q: 0, r: 0 })
  })

  test('半径 3：1+6+12+18 = 37 格', () => {
    const map = generateMap(1, 3)
    expect(map.hexes).toHaveLength(37)
  })

  test('半径 6：127 格（脚手架默认）', () => {
    const map = generateMap(42, 6)
    expect(map.hexes).toHaveLength(127)
  })

  test('每个 hex 都有地形', () => {
    const map = generateMap(42, 6)
    for (const h of map.hexes) {
      expect(map.terrain[hexKey(h)]).toBeDefined()
    }
  })

  test('出生点 clearing：中心及其 6 邻居必须可通行（英雄开局能移动、视线不被出生格阻挡）', () => {
    const map = generateMap(42, 6)
    const center: Axial = { q: 0, r: 0 }
    const key = (h: Axial) => hexKey(h)
    // 中心必须是平地（英雄站得住）
    expect(map.terrain[key(center)]).toBe('plain')
    // 六邻居全部可通行（不能是山脉/河流）
    const passable = new Set(['plain', 'forest', 'desert', 'swamp'])
    for (const hex of map.hexes) {
      if (hexDistance(center, hex) === 1) {
        expect(passable.has(map.terrain[key(hex)] as string)).toBe(true)
      }
    }
  })

  test('确定性：同种子两次生成结果一致', () => {
    const a = generateMap(42, 6)
    const b = generateMap(42, 6)
    expect(a).toEqual(b)
  })

  test('不同种子生成不同地形（且所有 hex 在半径内）', () => {
    const a = generateMap(42, 5)
    const b = generateMap(43, 5)
    expect(a.terrain).not.toEqual(b.terrain)
    for (const h of a.hexes) {
      expect(hexDistance({ q: 0, r: 0 } as Axial, h)).toBeLessThanOrEqual(5)
    }
  })
})

describe('generateMap 资源点放置', () => {
  test('半径 6 放置 8 个资源点（含矿与宝箱）', () => {
    const map = generateMap(42, 6)
    const types = Object.values(map.nodes)
    expect(types.length).toBe(8)
    expect(types.some((t) => t === 'woodMine')).toBe(true)
    expect(types.some((t) => t === 'stoneMine')).toBe(true)
    expect(types.some((t) => t === 'ironMine')).toBe(true)
    expect(types.some((t) => t === 'chest')).toBe(true)
  })

  test('资源点落在平地格、且不在出生 clearing（中心+六邻居）', () => {
    const map = generateMap(42, 6)
    const clearingKeys = new Set<string>([hexKey({ q: 0, r: 0 })])
    const center: Axial = { q: 0, r: 0 }
    for (const h of map.hexes) {
      if (hexDistance(center, h) === 1) clearingKeys.add(hexKey(h))
    }
    for (const [k, type] of Object.entries(map.nodes)) {
      expect(type).toBeDefined()
      expect(clearingKeys.has(k)).toBe(false)
      expect(map.terrain[k]).toBe('plain')
    }
  })

  test('确定性：同种子资源点布局一致', () => {
    const a = generateMap(42, 6)
    const b = generateMap(42, 6)
    expect(a.nodes).toEqual(b.nodes)
  })

  test('小地图（半径 2）也至少 1 个资源点', () => {
    const map = generateMap(1, 2)
    expect(Object.keys(map.nodes).length).toBeGreaterThanOrEqual(1)
  })
})
