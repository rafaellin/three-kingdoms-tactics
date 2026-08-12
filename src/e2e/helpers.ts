import type { Page } from '@playwright/test'

/** 主菜单按钮中心（1920×1080 设计基准） */
export const MENU_START = { x: 960, y: 594 }
export const MENU_BATTLE = { x: 960, y: 734 }

interface DebugState {
  ready?: boolean
  scene?: string
  okButton?: { x: number; y: number } | null
  menu?: { buttonsEnabled?: boolean }
}

const readState = (page: Page): Promise<DebugState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugState } }).__game?.getState() ?? {})

/** 启动游戏到主菜单就绪：loading →（OK 按钮，如出现）→ 主菜单淡入完成 */
export async function gotoBooted(page: Page): Promise<void> {
  await page.goto('/')
  // 等待 Phaser 起好、canvas 出现
  await page.waitForSelector('canvas', { state: 'attached' })
  // 等 loading 结束：主菜单出现，或 Loading 显示 OK 按钮
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'menu' || (s?.scene === 'loading' && s?.okButton != null)
  })
  const s = await readState(page)
  if (s.scene === 'loading' && s.okButton) {
    // 点击 OK 解锁音频 → 进入主菜单
    await page.mouse.click(s.okButton.x, s.okButton.y)
    await page.waitForFunction(() => {
      const g = (window as { __game?: { getState(): DebugState } }).__game
      return g?.getState()?.scene === 'menu'
    })
  }
  // 主菜单淡入完成、按钮可点
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): DebugState } }).__game
    return g?.getState()?.menu?.buttonsEnabled === true
  })
  // readState 调用 flush CDP 桥接，确保后续 click + waitForFunction 不会因
  // raf 轮询与 Phaser 场景切换的竞态而卡死
  await readState(page)
}

/** 主菜单 → 大地图并等待就绪 */
export async function gotoAdventure(page: Page): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'adventure' && s?.ready === true
  })
}

/** 主菜单 → 战斗并等待就绪 */
export async function gotoBattle(page: Page): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'battle' && s?.ready === true
  })
}
