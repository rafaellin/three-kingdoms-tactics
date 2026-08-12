import { expect, test } from '@playwright/test'
import { gotoAdventure } from './helpers'

interface DebugState {
  ready?: boolean
  camera?: { x: number; y: number; zoom: number }
  uiCameraZoom?: number
}

/**
 * 相机缩放回归：只有大地图（主相机）随滚轮缩放，HUD / 工具栏保持不动。
 * 验证方式（状态断言，不依赖截图）：
 * - 主相机 zoom 在 Map 区滚轮后 > 1；
 * - UI 相机（渲染 HUD/工具栏）zoom 恒为 1；
 * - 在 HUD 区（y < HUD_H）滚轮不触发地图缩放（与拖拽/点击同一分区规则）。
 */
test('滚轮缩放只作用主相机（大地图），HUD/工具栏不缩放', async ({ page }) => {
  await gotoAdventure(page)

  const readState = () =>
    page.evaluate(() => {
      const g = (window as { __game?: { getState(): DebugState } }).__game
      return g?.getState()
    })

  const initial = await readState()
  expect(initial?.camera?.zoom).toBe(1)
  expect(initial?.uiCameraZoom).toBe(1)

  // 在 Map 区（y=300：HUD 之下、工具栏之上）滚轮向上 → 地图放大
  await page.mouse.move(960, 300)
  await page.mouse.wheel(0, -120)
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): DebugState } }).__game
    return (g?.getState()?.camera?.zoom ?? 1) > 1
  })

  const zoomed = await readState()
  expect(zoomed?.camera?.zoom).toBeGreaterThan(1)
  // HUD/工具栏由固定 UI 相机渲染：主相机缩放不影响它
  expect(zoomed?.uiCameraZoom).toBe(1)

  // 在 HUD 区（y=20 < HUD_H=48）滚轮：不触发地图缩放（分区规则与拖拽/点击一致）
  await page.mouse.move(960, 20)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(100)
  const afterHudWheel = await readState()
  expect(afterHudWheel?.camera?.zoom).toBe(zoomed?.camera?.zoom)
  expect(afterHudWheel?.uiCameraZoom).toBe(1)
})
