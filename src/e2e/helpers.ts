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
  /** 战役选择界面：按钮可点（CampaignSelectScene 顶层暴露） */
  buttonsEnabled?: boolean
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

/** 开场剧情 modal 的 debug 状态（e2e 读取/点击用） */
interface IntroState {
  open?: boolean
  button?: string | null
  buttonX?: number | null
  buttonY?: number | null
}

/** 关闭开场剧情 modal（读 debug 里的按钮坐标；朗读中「跳过」→「开始」） */
export async function dismissCampaignIntro(page: Page): Promise<void> {
  // 等 modal 打开（gotoCampaign 进入战役后必现；explore 模式无 intro 不会走到这里）
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState() as DebugState & {
      intro?: IntroState
    }
    return s?.scene === 'adventure' && s?.intro?.open === true
  })
  const clickIntroButton = async (): Promise<void> => {
    const s = (await readState(page)) as DebugState & { intro?: IntroState }
    const intro = s.intro
    if (!intro?.open || intro.buttonX == null || intro.buttonY == null) return
    await page.mouse.click(intro.buttonX, intro.buttonY)
  }
  // 仍在朗读（跳过）→ 先点「跳过」进「开始」；否则直接「开始」
  const s0 = (await readState(page)) as DebugState & { intro?: IntroState }
  if (s0.intro?.button === 'skip') {
    await clickIntroButton()
    await page.waitForFunction(() => {
      const g = (window as { __game?: { getState(): DebugState } }).__game
      const st = g?.getState() as DebugState & { intro?: IntroState }
      return st?.intro?.button === 'start'
    })
  }
  await clickIntroButton()
  // 等 modal 关闭（手势锁已在尾随 pointerup 释放）
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): DebugState } }).__game
    const st = g?.getState() as DebugState & { intro?: IntroState }
    return st?.scene === 'adventure' && st?.intro?.open === false
  })
  // 同步往返排空输入副作用（与 gotoBooted 同机制）
  await readState(page)
}

/** 主菜单 → 战役选择 → 东岭关 → 大地图（战役模式）并等待就绪；默认关闭开场剧情 modal */
export async function gotoCampaign(page: Page, opts?: { dismissIntro?: boolean }): Promise<void> {
  await gotoBooted(page)
  await page.mouse.click(MENU_CAMPAIGN.x, MENU_CAMPAIGN.y)
  // 战役选择界面：等按钮可点 → 点第一个战役（东岭关）
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'campaignSelect' && s?.buttonsEnabled === true
  })
  const select = (await readState(page)) as DebugState & { campaigns?: { x: number; y: number }[] }
  const first = select.campaigns?.[0]
  if (!first) throw new Error('gotoCampaign: 战役选择界面无战役按钮')
  await page.mouse.click(first.x, first.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugState } }).__game?.getState()
    return s?.scene === 'adventure' && s?.ready === true
  })
  // 开场剧情 modal 会挡地图输入：默认关闭（需要断言 modal 行为的测试传 dismissIntro:false）
  if (opts?.dismissIntro !== false) {
    await dismissCampaignIntro(page)
  }
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
