import type { Page } from '@playwright/test'

/** 主菜单按钮中心（1920×1080 设计基准） */
export const MENU_START = { x: 960, y: 594 }
export const MENU_BATTLE = { x: 960, y: 734 }

/** 从主菜单进入大地图并等待就绪（原各 spec 直接 goto 后即见大地图，现需点按钮） */
export async function gotoAdventure(page: Page): Promise<void> {
  await page.goto('/')
  // 等待 Phaser 起好、canvas 出现（page.goto 的 load 事件不一定意味着 scene.create 已跑完）
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): { ready?: boolean } } }).__game
    return g?.getState()?.ready === true
  })
}
