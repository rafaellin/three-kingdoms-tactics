import { describe, expect, test } from 'vitest'
import { UNIT_DEFS } from './units'

describe('兵种属性表', () => {
  test('覆盖 MVP 五兵种', () => {
    for (const id of ['militia', 'swordsman', 'pikeman', 'archer', 'cavalry'] as const) {
      expect(UNIT_DEFS[id]).toBeDefined()
    }
  })
  test('字段合法：伤害区间/速度/生命/射程/尺寸', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      expect(def.minDamage).toBeLessThanOrEqual(def.maxDamage)
      expect(def.speed).toBeGreaterThan(0)
      expect(def.hp).toBeGreaterThan(0)
      expect(def.range).toBeGreaterThanOrEqual(1)
      expect([1, 2]).toContain(def.size)
    }
  })
  test('弓兵远程射程 6、骑兵 1×2', () => {
    expect(UNIT_DEFS.archer?.range).toBe(6)
    expect(UNIT_DEFS.cavalry?.size).toBe(2)
  })
})
