import { expect, test } from '@playwright/test'
import { gotoAdventure, gotoBooted, gotoBattle } from './helpers'
import { readdirSync, readFileSync } from 'node:fs'

/** 期望曲目数：只统计 assets/bgm/mp3/ 下的音频（assets/bgm/wav/ 是原声碟，游戏不加载） */
const EXPECTED_TRACKS = readdirSync('assets/bgm/mp3').filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f)).length

/** BGM 配置（跟随 src/data/bgmConfig.json） */
interface BgmConfig {
  categories: { menu: string[]; battle: string[]; explore: string[] }
}
const BGM_CONFIG = JSON.parse(readFileSync('src/data/bgmConfig.json', 'utf8')) as BgmConfig

const EXPLORATION_TRACKS = BGM_CONFIG.categories.explore
const MENU_TRACK = BGM_CONFIG.categories.menu[0] as string

interface BgmState {
  ready?: boolean
  volume?: number
  playing?: boolean
  trackCount?: number
  playlist?: string[]
  currentCategory?: string | null
  currentTrack?: string | null
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  bgm?: BgmState
}

const getBgm = (page: import('@playwright/test').Page): Promise<BgmState> =>
  page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugGameState } }).__game
    return g?.getState()?.bgm ?? {}
  })

const waitBgmPlaying = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.bgm?.playing === true)

const setBgmVolume = (page: import('@playwright/test').Page, v: number) =>
  page.evaluate((vol) => (window as { __game?: { setBgmVolume(v: number): void } }).__game?.setBgmVolume(vol), v)

test('BGM：主菜单自动播放主题曲（menu playlist 单曲）', async ({ page }) => {
  await gotoBooted(page)
  await waitBgmPlaying(page)
  const bgm = await getBgm(page)
  expect(bgm.trackCount).toBe(EXPECTED_TRACKS)
  expect(bgm.currentCategory).toBe('menu')
  expect(bgm.currentTrack).toBe(MENU_TRACK)
  expect(bgm.playlist).toEqual([MENU_TRACK])
  expect(bgm.volume).toBeCloseTo(0.1)
})

test('BGM：开始游戏 → 探索 playlist 自动播放（无需点击）→ setBgmVolume 生效', async ({ page }) => {
  await gotoAdventure(page)
  await waitBgmPlaying(page)
  const bgm = await getBgm(page)
  expect(bgm.currentCategory).toBe('explore')
  expect(bgm.playlist?.length).toBe(EXPLORATION_TRACKS.length)
  for (const t of EXPLORATION_TRACKS) {
    expect(bgm.playlist).toContain(t)
  }
  expect(bgm.currentTrack).toBeTruthy()
  expect(EXPLORATION_TRACKS).toContain(bgm.currentTrack!)
  await setBgmVolume(page, 0.5)
  expect((await getBgm(page)).volume).toBeCloseTo(0.5)
  await setBgmVolume(page, 0)
  expect((await getBgm(page)).volume).toBe(0)
})

test('BGM：战斗测试 → battle 分类 + 左下角控件交互（音量滑块/上一首）', async ({ page }) => {
  await gotoBattle(page)
  await waitBgmPlaying(page)
  const getControls = () =>
    page.evaluate(() => {
      const g = (window as { __game?: { getState(): DebugGameState & { bgmControls?: { present?: boolean; prev?: { x: number; y: number }; next?: { x: number; y: number }; volume?: { x: number; y: number }; slider?: { x: number; y: number }; sliderVisible?: boolean } } } }).__game
      return g?.getState()?.bgmControls ?? {}
    })
  const c = await getControls()
  expect(c.present).toBe(true)
  expect((await getBgm(page)).currentCategory).toBe('battle')

  // 点音量按钮 → 滑块出现 → 点滑块中部 → 音量约 50%
  // 点击按钮中央而非左上角：Text 默认 origin(0,0)，x/y 为左上角；按钮含 padding 14×8、fontSize 20px → 中心 ≈ (x+24, y+18)
  await page.mouse.click(c.volume!.x + 24, c.volume!.y + 18)
  await page.waitForTimeout(50)
  expect((await getControls()).sliderVisible).toBe(true)
  await page.mouse.click(c.slider!.x + 60, c.slider!.y)
  await page.waitForTimeout(50)
  const vol = (await getBgm(page)).volume as number
  expect(vol).toBeGreaterThan(0.3)
  expect(vol).toBeLessThan(0.7)

  // 点上一首 → 仍为 battle 分类（playlist ≥ 2 时切换曲目）
  await page.mouse.click(c.prev!.x + 24, c.prev!.y + 18)
  await page.waitForTimeout(50)
  expect((await getBgm(page)).currentCategory).toBe('battle')
})
