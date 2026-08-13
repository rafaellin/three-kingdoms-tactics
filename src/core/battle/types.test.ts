import { describe, expect, test } from 'vitest'
import { hexKey } from '../hex/HexGrid'
import { occupiedHexes, woundedHp } from './types'

describe('occupiedHexes（1×1 / 1×2 占据格）', () => {
  test('size=1 只占主体格', () => {
    const hexes = occupiedHexes({ position: { q: 3, r: 2 }, size: 1 })
    expect(hexes.map(hexKey)).toEqual(['3,2'])
  })
  test('size=2 占主体格 + 东邻 (q+1, r)', () => {
    const hexes = occupiedHexes({ position: { q: 3, r: 2 }, size: 2 })
    expect(hexes.map(hexKey).sort()).toEqual(['3,2', '4,2'].sort())
  })
})

describe('woundedHp（伤兵剩余血量）', () => {
  test('末位伤兵血 = hpLeft - (count-1)×hp', () => {
    // 骑兵单兵 30 血：5 骑满编 hpLeft=150 吃 40 伤 → 110，count=ceil(110/30)=4 → 末者 110-3×30=20
    expect(woundedHp({ hpLeft: 110, count: 4, defId: 'cavalry' })).toBe(20)
  })
  test('满编无伤兵：末位兵满血', () => {
    expect(woundedHp({ hpLeft: 150, count: 5, defId: 'cavalry' })).toBe(30)
  })
})
