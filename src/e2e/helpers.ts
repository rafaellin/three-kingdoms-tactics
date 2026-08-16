import type { Page } from '@playwright/test'

/** 主菜单按钮中心（1920×1080 设计基准；Y = 1080×0.50 / 0.63 / 0.76） */
export const MENU_START = { x: 960, y: 540 }
export const MENU_CAMPAIGN = { x: 960, y: 680 }
export const MENU_BATTLE = { x: 960, y: 821 }

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
  // readState 通过 page.evaluate → CDP Runtime.evaluate 强制一次同步往返，
  // 将 Phaser 场景内 setInteractive / 场景切换等副作用排空（Phaser 的 input enable
  // 与场景生命周期在内部排队到下一帧微任务），确保后续 page.mouse.click 操作在
  // 目标元素已就绪的 DOM/input 状态下执行，消除竞态。
  await readState(page)
}

/** 主菜单 → 大地图（探索测试入口）并等待就绪 */
export async function gotoAdventure(page: Page): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'adventure' && s?.ready === true
  })
}

/** 主菜单 → 大地图（开始战役入口）并等待就绪 */
export async function gotoCampaign(page: Page): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_CAMPAIGN.x, MENU_CAMPAIGN.y)
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
