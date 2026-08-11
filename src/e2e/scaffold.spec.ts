import { expect, test } from '@playwright/test'
import { gotoAdventure } from './helpers'

interface DebugState {
  hexesRendered?: number
  seed?: number
  ready?: boolean
  resolution?: { width: number; height: number }
  camera?: { x: number; y: number; zoom: number }
}

/** PNG 文件头 IHDR 块（字节 16-23）即宽高，属"文件 meta 验证"，无需看图 */
function readPngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * 脚手架端到端回归：
 * 启动游戏 → 模拟操作 → 读真实状态断言 → 截图（供人工目检）。
 * 模型无多模态，验证一律以程序化断言为准。
 */
test('脚手架：渲染六角格地图，debug 状态可读，分辨率 1080p', async ({ page }) => {
  await gotoAdventure(page)
  await expect(page.locator('canvas')).toBeVisible()

  // 等待场景就绪（地图已生成）
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): DebugState } }).__game
    const n = g?.getState()?.hexesRendered
    return typeof n === 'number' && n > 0
  })

  const state = await page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugState } }).__game
    return g?.getState()
  })

  expect(state?.hexesRendered).toBeGreaterThan(0)
  expect(state?.seed).toBe(42)
  // 渲染分辨率 = 设计基准 1080p
  expect(state?.resolution).toEqual({ width: 1920, height: 1080 })
  // 地图中心（世界原点）应对齐屏幕中心：1920×1080 视口 → scroll(-960, -540)
  expect(state?.camera?.zoom).toBe(1)
  expect(Math.abs((state?.camera?.x ?? 0) + 960)).toBeLessThanOrEqual(2)
  expect(Math.abs((state?.camera?.y ?? 0) + 540)).toBeLessThanOrEqual(2)

  // 截图文件 meta 校验：IHDR 宽高应为 1920×1080（给人工目检用）
  const buf = await page.screenshot({ path: 'screenshots/scaffold.png' })
  expect(readPngSize(buf)).toEqual({ width: 1920, height: 1080 })
})
