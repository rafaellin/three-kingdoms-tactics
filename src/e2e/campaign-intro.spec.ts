import { expect, test, type Page } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 开场剧情 modal e2e：进入战役弹文稿 + 朗读中「跳过」→「开始」→ 点「开始」才解锁地图。
 * - modal 打开时地图输入被挡（点杂兵格不移动）；
 * - 点「跳过」→ 按钮变「开始」；点「开始」→ modal 关闭、地图可交互（点杂兵进战斗）。
 * 断言一律程序化（window.__game.getState()），不依赖看截图；截图仅供人工目检。
 */
interface IntroState {
  open?: boolean
  button?: string | null
  buttonX?: number | null
  buttonY?: number | null
}

interface DebugGameState {
  ready?: boolean
  scene?: string
  mode?: string | null
  campaignId?: string | null
  intro?: IntroState
  heroes?: { generalId: string; position: { q: number; r: number }; screen?: { x: number; y: number } }[]
  neutrals?: { id: string; position: { q: number; r: number }; defeated: boolean; screen?: { x: number; y: number } }[]
  // battle 状态
  phase?: string
}

const readState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

test('开场剧情 modal：弹文稿（朗读「跳过」）→ 地图输入被挡 → 点「开始」解锁地图', async ({ page }) => {
  // 不自动关 modal，验证其行为
  await gotoCampaign(page, { dismissIntro: false })
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))

  // modal 打开：按钮态 = 朗读中（skip）
  let s = await readState(page)
  expect(s.mode).toBe('campaign')
  expect(s.campaignId).toBe('dongling')
  expect(s.intro?.open).toBe(true)
  expect(s.intro?.button).toBe('skip')
  expect(s.intro?.buttonX).not.toBeNull()

  // modal 打开期间地图输入被挡：点杂兵格 → 英雄不移动、不进战斗
  const guanBefore = s.heroes!.find((h) => h.generalId === 'g-guan')!
  const neutral = s.neutrals!.find((n) => n.id === 'neu-1')!
  await page.mouse.click(neutral.screen!.x, neutral.screen!.y)
  await page.waitForTimeout(200)
  s = await readState(page)
  expect(s.scene).toBe('adventure') // 未进战斗
  expect(s.heroes!.find((h) => h.generalId === 'g-guan')!.position).toEqual(guanBefore.position)
  await page.screenshot({ path: 'screenshots/campaign-intro-modal.png' })

  // 点「跳过」→ 按钮变「开始」
  await page.mouse.click(s.intro!.buttonX!, s.intro!.buttonY!)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.intro?.button === 'start'
  })
  s = await readState(page)
  expect(s.intro?.open).toBe(true) // modal 仍在（等玩家点「开始」）

  // 点「开始」→ modal 关闭
  await page.mouse.click(s.intro!.buttonX!, s.intro!.buttonY!)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.scene === 'adventure' && st?.intro?.open === false
  })
  // 同步往返排空输入副作用（手势锁在尾随 pointerup 已释放）
  await readState(page)

  // 地图可交互：点杂兵格 → 英雄移动到杂兵格 → 进战斗
  s = await readState(page)
  const neutral2 = s.neutrals!.find((n) => n.id === 'neu-1')!
  await page.mouse.click(neutral2.screen!.x, neutral2.screen!.y)
  await waitBattleReady(page)
  expect((await readState(page)).phase).toBe('combat')
})
