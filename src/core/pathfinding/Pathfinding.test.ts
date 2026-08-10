import { describe, expect, test } from 'vitest'
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { findPath, reachableArea, type MovementCost } from './Pathfinding'

/** 测试辅助：从阻塞格集合 + 统一步进代价构建 MovementCost */
function plainCosts(blocked: readonly Axial[] = [], step: number = 1): MovementCost {
  const blockedKeys = new Set(blocked.map(hexKey))
  return {
    cost(_from, to) {
      return blockedKeys.has(hexKey(to)) ? Number.POSITIVE_INFINITY : step
    }
  }
}

const setOf = (arr: Axial[]) => new Set(arr.map(hexKey))

describe('reachableArea（可达范围）', () => {
  test('平地 movement=1：中心 + 6 邻居 = 7 格', () => {
    const area = reachableArea({ q: 0, r: 0 }, 1, plainCosts())
    expect(area.length).toBe(7)
    expect(setOf(area).has('0,0')).toBe(true)
    expect(setOf(area).has('1,0')).toBe(true)
    expect(setOf(area).has('0,1')).toBe(true)
  })

  test('平地 movement=2：半径 2 六边形 = 19 格', () => {
    const area = reachableArea({ q: 0, r: 0 }, 2, plainCosts())
    expect(area.length).toBe(19)
  })

  test('每步消耗 2，movement=2：只能到达距离 1', () => {
    const area = reachableArea({ q: 0, r: 0 }, 2, plainCosts([], 2))
    expect(area.length).toBe(7)
    expect(setOf(area).has('2,0')).toBe(false)
  })

  test('阻塞格被排除且不可穿越', () => {
    const area = reachableArea({ q: 0, r: 0 }, 1, plainCosts([{ q: 1, r: 0 }]))
    expect(setOf(area).has('1,0')).toBe(false)
    expect(area.length).toBe(6)
  })

  test('确定性：同输入两次调用结果一致', () => {
    const a = reachableArea({ q: 0, r: 0 }, 3, plainCosts([{ q: 1, r: 0 }]))
    const b = reachableArea({ q: 0, r: 0 }, 3, plainCosts([{ q: 1, r: 0 }]))
    expect(a.map(hexKey)).toEqual(b.map(hexKey))
  })
})

describe('findPath（Dijkstra 最短路径）', () => {
  test('平地最短路径长度 = hexDistance + 1', () => {
    const start = { q: 0, r: 0 }
    const goal = { q: 3, r: -3 }
    const path = findPath(start, goal, plainCosts())
    expect(path).not.toBeNull()
    expect(path!.length).toBe(hexDistance(start, goal) + 1)
    expect(hexKey(path![0] as Axial)).toBe('0,0')
    expect(hexKey(path![path!.length - 1] as Axial)).toBe('3,-3')
  })

  test('绕开阻塞格，路径不含阻塞格', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, plainCosts([{ q: 1, r: 0 }]))
    expect(path).not.toBeNull()
    const keys = path!.map(hexKey)
    expect(keys).not.toContain('1,0')
    expect(keys[0]).toBe('0,0')
    expect(keys[keys.length - 1]).toBe('2,0')
  })

  test('被围死则返回 null', () => {
    const blocked = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 }
    ]
    const path = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, plainCosts(blocked))
    expect(path).toBeNull()
  })

  test('起点即终点：单元素路径', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 0, r: 0 }, plainCosts())
    expect(path).toEqual([{ q: 0, r: 0 }])
  })

  test('代价感知最优性：直穿沼泽贵于绕行平地，返回更便宜的绕路', () => {
    // 直线 (1,0)(2,0) 是沼泽（代价 2 步），绕行下排一路平地（代价 1 步）
    const swampCosts: MovementCost = {
      cost(_from, to) {
        return to.q === 1 && to.r === 0 || (to.q === 2 && to.r === 0) ? 2 : 1
      }
    }
    const path = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, swampCosts)
    expect(path).not.toBeNull()
    const keys = path!.map(hexKey)
    // 不穿沼泽：路径避开 (1,0) 和 (2,0)
    expect(keys).not.toContain('1,0')
    expect(keys).not.toContain('2,0')
    // 沿 (0,0)→(1,-1)→(2,-1)→(3,-1)→(3,0)，共 4 步平地 = 4 < 直线 5
    expect(path!.length).toBe(5)
    let total = 0
    for (let i = 1; i < path!.length; i++) total += swampCosts.cost(path![i - 1] as Axial, path![i] as Axial)
    expect(total).toBe(4)
  })
})
