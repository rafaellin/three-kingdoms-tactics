import { expect, test } from '@playwright/test'
import { gotoAdventure } from './helpers'
import { readdirSync, readFileSync } from 'node:fs'

/** 期望曲目数：只统计 assets/bgm/mp3/ 下的音频（assets/bgm/wav/ 是原声碟，游戏不加载） */
const EXPECTED_TRACKS = readdirSync('assets/bgm/mp3').filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f)).length

/** 主题曲（配置文件 src/data/bgmConfig.json 决定；测试跟随配置） */
const { themeSong: THEME_SONG } = JSON.parse(readFileSync('src/data/bgmConfig.json', 'utf8')) as {
  themeSong: string
}

/**
 * BGM 背景音乐 e2e 回归（渲染层）。
 *
 * 断言项（程序化状态流，不依赖音频输出设备）：
 *  - assets/bgm/mp3/ 音频加载就绪（ready），只加载 mp3/（wav/ 原声碟不算）
 *  - 首次用户交互（pointerdown）后起播（playing）——浏览器自动播放策略要求手势内触发
 *  - 主题曲（src/data/bgmConfig.json 配置）固定 playlist 第一首，其余随机
 *  - 默认音量 10%（0.1，用户要求宁小勿吵）
 *  - setBgmVolume 改变音量（未来"设置"界面的接线点）
 *
 * 注：无多模态/无声卡，实际音质由人工试听确认；本测试只验证状态与接线。
 */

interface BgmState {
  ready?: boolean
  volume?: number
  playing?: boolean
  trackCount?: number
  playlist?: string[]
}

interface DebugGameState {
  ready?: boolean
  bgm?: BgmState
}

const getBgm = (page: import('@playwright/test').Page): Promise<BgmState> =>
  page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugGameState } }).__game
    return g?.getState()?.bgm ?? {}
  })


const waitBgmReady = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.bgm?.ready === true)

const waitBgmPlaying = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.bgm?.playing === true)

const setBgmVolume = (page: import('@playwright/test').Page, v: number) =>
  page.evaluate((vol) => (window as { __game?: { setBgmVolume(v: number): void } }).__game?.setBgmVolume(vol), v)

test('BGM：音频就绪 → 首次交互起播 → 默认 10% 音量 → setBgmVolume 生效', async ({ page }) => {
  await gotoAdventure(page)
  // 未交互前：音频已就绪、未起播、默认 10% 音量、至少 1 首曲目
  await waitBgmReady(page)
  const before = await getBgm(page)
  // 只加载 mp3/ 的音频进 playlist（wav/ 原声碟不算）
  expect(before.trackCount).toBe(EXPECTED_TRACKS)
  expect(before.playing).toBe(false)
  expect(before.volume).toBeCloseTo(0.1)

  // 首次用户交互（点击地图中心）→ 解锁音频并随机起播
  await page.mouse.click(1920 / 2, 1080 / 2)
  await waitBgmPlaying(page)
  expect((await getBgm(page)).playing).toBe(true)

  // 主题曲（配置文件指定）固定 playlist 第一首，其余随机；不丢曲目
  const after = await getBgm(page)
  expect(after.playlist?.[0]).toBe(THEME_SONG)
  expect(after.playlist?.length).toBe(EXPECTED_TRACKS)
  expect(after.playlist).toEqual(expect.arrayContaining([THEME_SONG]))

  // setBgmVolume：音量随设置变化（未来"设置"界面接线点）
  await setBgmVolume(page, 0.5)
  expect((await getBgm(page)).volume).toBeCloseTo(0.5)
  await setBgmVolume(page, 0)
  expect((await getBgm(page)).volume).toBe(0)
})
