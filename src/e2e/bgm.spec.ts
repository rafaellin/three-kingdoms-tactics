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

test('BGM：战斗测试 → battle 分类自动播放', async ({ page }) => {
  await gotoBattle(page)
  await waitBgmPlaying(page)
  const bgm = await getBgm(page)
  expect(bgm.currentCategory).toBe('battle')
  expect(bgm.playlist?.length).toBe(BGM_CONFIG.categories.battle.length)
})
