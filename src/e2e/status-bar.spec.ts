import { expect, test } from '@playwright/test'
import { gotoCampaign } from './helpers'
import { HexLayout, type Axial } from '../core/hex/HexGrid'

/**
 * 底部当前武将信息条 e2e：StatusBar（Task 4）。
 * 流程全部程序化断言（window.__game.getState()）：
 * - 进战役 → 信息条显示当前武将 `關羽 Lv5 移动力 6/6` + 部队列表 `刀兵 ×20  弓兵 ×12`（逐格条目）；
 * - 移动一格（平地 cost 1）→ 移动力变 `5/6`；
 * - 按 h 切到周仓 → 信息条变 `周倉 Lv5 移动力 6/6` + `枪兵 ×15  民兵 ×20`。
 * 截图仅供人工目检；断言一律程序化。
 */

interface DebugGameState {
  ready?: boolean
  selectedHeroId?: string | null
  heroes?: { generalId: string; position?: Axial }[]
  statusBar?: {
    hero: string
    units: string[]
    text: string
  } | null
}

type Page = import('@playwright/test').Page

const readState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

/** 地图中心（世界原点）在屏幕中心 1920×1080；hex → 屏幕像素（与 AdventureScene camera.centerOn(0,0) 一致） */
const hexToScreen = (h: Axial): { x: number; y: number } => {
  const p = new HexLayout({ size: 36, origin: { x: 0, y: 0 } }).hexToPixel(h)
  return { x: 960 + p.x, y: 540 + p.y }
}

const waitHeroAt = async (page: Page, heroId: string, pos: Axial): Promise<void> => {
  await page.waitForFunction(
    ({ heroId, pos }) => {
      const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
      const h = s?.heroes?.find((x) => x.generalId === heroId)
      return h?.position?.q === pos.q && h?.position?.r === pos.r
    },
    { heroId, pos }
  )
}

test('底部信息条：进战役显示关羽 + 部队；移动后移动力变化；切武将后信息条变化', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))

  // ① 初始：当前武将关羽 Lv5 移动力 6/6 + 部队逐格列出（刀兵 ×20 弓兵 ×12）
  let s = await readState(page)
  expect(s.selectedHeroId).toBe('g-guan')
  expect(s.statusBar).not.toBeNull()
  expect(s.statusBar?.hero).toBe('關羽 Lv5 移动力 6/6')
  expect(s.statusBar?.units).toEqual(['刀兵 ×20', '弓兵 ×12'])
  expect(s.statusBar?.text).toBe('關羽 Lv5 移动力 6/6  刀兵 ×20  弓兵 ×12')

  // ② 移动一格：关羽出生 (0,-1) → 点击 (-1,0)（平地，移动力扣 1 → 5/6）
  await page.mouse.click(hexToScreen({ q: -1, r: 0 }).x, hexToScreen({ q: -1, r: 0 }).y)
  await waitHeroAt(page, 'g-guan', { q: -1, r: 0 })
  s = await readState(page)
  expect(s.statusBar?.hero).toBe('關羽 Lv5 移动力 5/6')
  expect(s.statusBar?.units).toEqual(['刀兵 ×20', '弓兵 ×12'])

  // ③ 按 h 切到周仓 → 信息条变（周倉 Lv5 满移动力 + 枪兵/民兵）
  await page.keyboard.press('h')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.selectedHeroId === 'g-zhoucang'
  )
  s = await readState(page)
  expect(s.statusBar?.hero).toBe('周倉 Lv5 移动力 6/6')
  expect(s.statusBar?.units).toEqual(['枪兵 ×15', '民兵 ×20'])

  // 截图交人工目检：屏幕底部信息条（关羽 Lv5 移动力 5/6 + 刀兵×20 弓兵×12）
  await page.screenshot({ path: 'screenshots/status-bar.png' })
})
