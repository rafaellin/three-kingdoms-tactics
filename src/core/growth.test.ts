import { describe, expect, test } from 'vitest'
import { MAX_LEVEL, XP_BASE, XP_GROWTH, maxUnits, xpToNext } from './growth'

describe('xpToNext 经验曲线（等比 1.2）', () => {
  test('基础常量：Lv1→2 需 1000、等比 1.2、硬上限 30', () => {
    expect(XP_BASE).toBe(1000)
    expect(XP_GROWTH).toBe(1.2)
    expect(MAX_LEVEL).toBe(30)
  })

  test('前三级：1000 / 1200 / 1440', () => {
    expect(xpToNext(1)).toBe(1000)
    expect(xpToNext(2)).toBe(1200)
    expect(xpToNext(3)).toBe(1440)
  })

  test('Lv20 = round(1000×1.2^19) = 31948（浮点 ±1 容差内）', () => {
    expect(xpToNext(20)).toBe(31948)
  })

  test('Lv30 = round(1000×1.2^29)，与公式自洽', () => {
    expect(xpToNext(30)).toBe(Math.round(1000 * Math.pow(XP_GROWTH, 29)))
  })
})

describe('maxUnits 部队数上限（Lv1 起 4 支，每 5 级 +1，封顶 7）', () => {
  test('Lv1-4=4 / Lv5-9=5 / Lv10-14=6 / Lv15+=7', () => {
    expect(maxUnits(1)).toBe(4)
    expect(maxUnits(4)).toBe(4)
    expect(maxUnits(5)).toBe(5)
    expect(maxUnits(9)).toBe(5)
    expect(maxUnits(10)).toBe(6)
    expect(maxUnits(14)).toBe(6)
    expect(maxUnits(15)).toBe(7)
    expect(maxUnits(30)).toBe(7)
  })
})
