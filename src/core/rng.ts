/**
 * 确定性随机数发生器（mulberry32）。
 *
 * 确定性铁律：core 内禁止裸 `Math.random()`，一切随机必须走本类实例，
 * 以便用固定种子复现任意状态序列（回放 / 回归测试）。
 */
export class RNG {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** 返回 [0,1) 的浮点数 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** 返回闭区间 [min, max] 的整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** 从数组中随机取一个元素 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)] as T
  }
}
