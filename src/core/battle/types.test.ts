import { describe, expect, test } from 'vitest'
import { hexKey } from '../hex/HexGrid'
import { occupiedHexes } from './types'

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
