import { expect, test } from '@playwright/test'
import { gotoAdventure, gotoBooted, MENU_START, MENU_CAMPAIGN, MENU_BATTLE } from './helpers'

interface MenuButtonState {
  label?: string
  x?: number
  y?: number
}

interface DebugState {
  ready?: boolean
  scene?: string
  menu?: { buttonsEnabled?: boolean; buttons?: MenuButtonState[] }
}

const readState = (page: Parameters<typeof gotoBooted>[0]): Promise<DebugState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugState } }).__game?.getState() ?? {})

/**
 * 主菜单三入口回归：
 * 启动 → 三按钮可见且坐标正确、buttonsEnabled=true；三个入口都能正确导航。
 * 断言一律程序化（window.__game.getState()），不依赖看截图。
 */
test('主菜单：三入口可见、坐标正确，buttonsEnabled=true', async ({ page }) => {
  await gotoBooted(page)
  const s = await readState(page)
  expect(s.scene).toBe('menu')
  expect(s.menu?.buttonsEnabled).toBe(true)
  const labels = s.menu?.buttons?.map((b) => b.label) ?? []
  expect(labels).toEqual(['探索测试', '开始战役', '战斗测试'])
  const btn = (label: string) => s.menu?.buttons?.find((b) => b.label === label)
  expect(btn('探索测试')?.x).toBeCloseTo(MENU_START.x, 0)
  expect(btn('探索测试')?.y).toBeCloseTo(MENU_START.y, 0)
  expect(btn('开始战役')?.x).toBeCloseTo(MENU_CAMPAIGN.x, 0)
  expect(btn('开始战役')?.y).toBeCloseTo(MENU_CAMPAIGN.y, 0)
  expect(btn('战斗测试')?.x).toBeCloseTo(MENU_BATTLE.x, 0)
  expect(btn('战斗测试')?.y).toBeCloseTo(MENU_BATTLE.y, 0)
})

test('主菜单：点击探索测试进入大地图', async ({ page }) => {
  await gotoAdventure(page)
  // gotoAdventure 内部已等待 scene==='adventure' && ready，到达即导航通过
  const s = await readState(page)
  expect(s.scene).toBe('adventure')
  expect(s.ready).toBe(true)
})

test('主菜单：点击开始战役进入战役选择界面（fadeAndStart 传 data）', async ({ page }) => {
  await gotoBooted(page)
  await page.mouse.click(MENU_CAMPAIGN.x, MENU_CAMPAIGN.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'campaignSelect'
  })
})
