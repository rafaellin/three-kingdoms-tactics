import { describe, expect, test } from 'vitest'
import { RNG } from './rng'

describe('RNG（确定性随机数）', () => {
  test('相同种子产生相同序列', () => {
    const a = new RNG(123)
    const b = new RNG(123)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  test('不同种子产生不同序列', () => {
    const a = new RNG(1)
    const b = new RNG(2)
    expect(a.next()).not.toBe(b.next())
  })

  test('next 始终落在 [0,1)', () => {
    const rng = new RNG(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('int 落在闭区间 [min,max]', () => {
    const rng = new RNG(9)
    for (let i = 0; i < 500; i++) {
      const v = rng.int(1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  test('pick 返回数组中的元素', () => {
    const rng = new RNG(5)
    const arr = ['a', 'b', 'c']
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr))
    }
  })
})
