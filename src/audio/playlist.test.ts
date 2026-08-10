import { describe, expect, it } from 'vitest'
import { buildPlaylist, nextTrackIndex, shuffleTracks } from './playlist'

/**
 * BGM playlist 纯逻辑单测（注入确定性 rng，断言确定输入 → 输出）。
 */

describe('shuffleTracks（Fisher–Yates，注入 rng）', () => {
  it('rng 恒为 0 时：每个位置与下标 0 交换，结果确定', () => {
    // i=3→0、i=2→0、i=1→0 依次交换：['a','b','c','d'] → ['b','c','d','a']
    expect(shuffleTracks(['a', 'b', 'c', 'd'], () => 0)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('单曲 / 空列表原样返回', () => {
    expect(shuffleTracks(['a'], () => 0)).toEqual(['a'])
    expect(shuffleTracks([], () => 0)).toEqual([])
  })

  it('结果是对原集合的重排（不增删元素），且一般会打乱顺序', () => {
    const tracks = ['a', 'b', 'c', 'd', 'e']
    const out = shuffleTracks(tracks, () => 0.5)
    expect([...out].sort()).toEqual([...tracks].sort())
    expect(out).not.toEqual(tracks)
  })
})

describe('buildPlaylist（主题曲固定第一首，其余随机；未找到则无主题曲、全随机）', () => {
  it('主题曲存在：固定第一首，其余随机排序', () => {
    // 其余 ['a','c','d'] 用 rng=0 洗牌 → ['c','d','a']
    expect(buildPlaylist(['a', 'b', 'c', 'd'], 'b', () => 0)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('主题曲不存在：无主题曲，全部随机（结果是对全部曲目的重排）', () => {
    expect(buildPlaylist(['a', 'b', 'c'], 'zz', () => 0)).toEqual(['b', 'c', 'a'])
  })

  it('主题曲为空串：等同无主题曲', () => {
    expect(buildPlaylist(['a', 'b', 'c'], '', () => 0)).toEqual(['b', 'c', 'a'])
  })

  it('只有主题曲一首：返回 [主题曲]', () => {
    expect(buildPlaylist(['a'], 'a', () => 0)).toEqual(['a'])
  })

  it('主题曲存在时：playlist[0] 恒为主题曲，且不丢曲目', () => {
    const tracks = ['a', 'b', 'c', 'd', 'e']
    const out = buildPlaylist(tracks, 'c', () => 0.5)
    expect(out[0]).toBe('c')
    expect([...out].sort()).toEqual([...tracks].sort())
  })
})

describe('nextTrackIndex（播放完一首推进到下一首，到头循环）', () => {
  it('普通推进 +1', () => {
    expect(nextTrackIndex(0, 4)).toBe(1)
    expect(nextTrackIndex(2, 4)).toBe(3)
  })

  it('到末尾回到开头（循环 playlist）', () => {
    expect(nextTrackIndex(3, 4)).toBe(0)
  })

  it('空列表安全返回 0', () => {
    expect(nextTrackIndex(0, 0)).toBe(0)
  })
})
