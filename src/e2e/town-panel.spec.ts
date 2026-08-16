import { expect, test } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 城池界面 e2e：TownPanel（驻军/驻城/访问 + 移兵/驻守/交换/出城）。
 * 流程全部程序化断言（window.__game.getState()）：
 * - 关羽从 (0,-1) 点击城池 (0,0) 走进 → 自动进城（访问武将：仍在地图上，位置=城格叠城上）；
 * - 点击城池格打开 TownPanel → 断言 驻军/驻城/访问 渲染；
 * - 驻守 → garrisonGeneralId + 从 heroes 移除；移兵（英雄↔驻军 双向）；出城 → 回 heroes；
 * - 交换单槽场景：只有访问点交换=进驻（从 heroes 移除）、只有驻城点交换=出城（回 heroes）；
 * - 双槽满 → 交换=槽位互换；
 * - 面板按钮坐标经 getDebugState().townPanel.buttons 读取后点击（与 gotoBooted 的 OK 按钮同模式）。
 * 模型无多模态：断言一律程序化；截图仅供人工目检。
 */

/** 东岭小城 (0,0) 屏幕中心（1920×1080，相机 centerOn(0,0) → 屏幕中心 = 世界原点） */
const TOWN_SCREEN = { x: 960, y: 540 }

interface TownPanelButtonDebug {
  key: string
  label: string
  x: number
  y: number
  enabled: boolean
}

interface DebugGameState {
  ready?: boolean
  heroes?: { generalId: string; position: { q: number; r: number } }[]
  towns?: {
    id: string
    name: string
    owner: string
    level: number
    position: { q: number; r: number }
    garrison: { defId: string; count: number }[]
    garrisonGeneralId: string | null
    visitorGeneralId: string | null
  }[]
  generals?: { id: string; name: string; army: { defId: string; count: number }[] }[]
  townPanel?: {
    open: boolean
    name?: string
    garrison?: { defId: string; count: number }[]
    garrisonGeneralId?: string | null
    garrisonGeneralName?: string | null
    garrisonGeneralArmy?: { defId: string; count: number }[]
    visitorGeneralId?: string | null
    visitorGeneralName?: string | null
    buttons?: TownPanelButtonDebug[]
  } | null
}

type Page = import('@playwright/test').Page

const readState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

/** 点城池格（关羽走进）→ 自动进城（访问武将） */
const clickTownAndEnter = (page: Page, heroId: string) =>
  page.waitForFunction(
    (h) => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.visitorGeneralId === h,
    heroId
  )

/** 打开城池面板 */
const openPanel = (page: Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel?.open === true)

/** 按 key 读面板按钮坐标并点击（面板每次重绘后坐标可能变化 → 每点前重新读） */
const clickBtn = async (page: Page, key: string): Promise<void> => {
  const s = await readState(page)
  const b = s.townPanel?.buttons?.find((x) => x.key === key)
  expect(b, `面板按钮 ${key} 应存在`).toBeDefined()
  await page.mouse.click(b!.x, b!.y)
}

/** 武将 army 中某兵种数量 */
const armyOf = (s: DebugGameState, generalId: string, defId: string): number =>
  s.generals?.find((g) => g.id === generalId)?.army?.find((u) => u.defId === defId)?.count ?? 0

test('城池面板：进城→展示驻军/英雄→驻守→移兵双向→出城→关闭', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  // ① 关羽 (0,-1) 点城池 (0,0) → 走进 → 落地自动进城（访问=关羽；英雄保留在地图，位置=城格叠城上）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await clickTownAndEnter(page, 'g-guan')
  let s = await readState(page)
  const guanVisiting = s.heroes?.find((h) => h.generalId === 'g-guan')
  expect(guanVisiting).toBeDefined() // 访问武将仍在地图上
  expect(guanVisiting?.position).toEqual({ q: 0, r: 0 }) // 叠城上

  // ② 再点城池 → 打开面板：显示 访问英雄=关羽、驻军/驻城空
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await openPanel(page)
  s = await readState(page)
  expect(s.townPanel?.name).toBe('东岭小城')
  expect(s.townPanel?.visitorGeneralName).toBe('關羽')
  expect(s.townPanel?.visitorGeneralId).toBe('g-guan')
  expect(s.townPanel?.garrisonGeneralName).toBeNull()
  expect(s.townPanel?.garrison).toEqual([])

  // ③ 驻守 → 访问→驻城（驻城后从 heroes 移除，大地图不可见）
  await clickBtn(page, 'garrison')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrisonGeneralId === 'g-guan'
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrisonGeneralId).toBe('g-guan')
  expect(s.towns?.[0]?.visitorGeneralId).toBeNull()
  expect(s.heroes?.some((h) => h.generalId === 'g-guan')).toBe(false) // 驻城武将不在 heroes

  // ④ 移兵 英雄→驻军：关羽刀兵 20→19，驻军 刀兵×1
  await clickBtn(page, 'transfer-hero-swordsman-1')
  await page.waitForFunction(
    () =>
      (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrison?.some(
        (u) => u.defId === 'swordsman' && u.count === 1
      )
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrison).toEqual([{ defId: 'swordsman', count: 1 }])
  expect(armyOf(s, 'g-guan', 'swordsman')).toBe(19)
  // 截图交人工目检：城池面板（驻军×1 + 驻城英雄关羽 + 移兵 1/全 按钮）
  await page.screenshot({ path: 'screenshots/town-panel.png' })

  // ⑤ 移兵 驻军→英雄：刀兵 1→0（关羽回到 20）
  await clickBtn(page, 'transfer-garrison-swordsman-1')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrison?.length === 0
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrison).toEqual([])
  expect(armyOf(s, 'g-guan', 'swordsman')).toBe(20)

  // ⑥ 出城 → 关羽回 heroes（位置=城格），军队保持
  await clickBtn(page, 'leave')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.heroes?.some((h) => h.generalId === 'g-guan')
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrisonGeneralId).toBeNull()
  expect(s.heroes?.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 0 })
  expect(armyOf(s, 'g-guan', 'swordsman')).toBe(20)

  // ⑦ 关闭面板
  await clickBtn(page, 'close')
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel == null)
  expect((await readState(page)).townPanel).toBeNull()
})

test('城池面板：交换（双槽驻城↔访问互换）', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  // ① 关羽进城（访问）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await clickTownAndEnter(page, 'g-guan')

  // ② 打开面板 → 驻守（garrison=关羽）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await openPanel(page)
  await clickBtn(page, 'garrison')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrisonGeneralId === 'g-guan'
  )

  // ③ 关闭面板 → 点城池（当前英雄=周仓）→ 周仓走进 → 自动进城（访问=周仓）
  await clickBtn(page, 'close')
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel == null)
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await clickTownAndEnter(page, 'g-zhoucang')

  // ④ 打开面板：garrison=关羽、visitor=周仓（双槽满）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await openPanel(page)
  let s = await readState(page)
  expect(s.towns?.[0]?.garrisonGeneralId).toBe('g-guan')
  expect(s.towns?.[0]?.visitorGeneralId).toBe('g-zhoucang')

  // ⑤ 双槽满时移兵（actor 匹配 bug 回归）：按钮在「驻城武将」关羽 army 上，
  //    移兵扣的是驻城关羽的兵、访问周仓不动（reducer transferTroops = garrison 优先）
  const guanSwordsBefore = armyOf(s, 'g-guan', 'swordsman')
  const zhouPikeBefore = armyOf(s, 'g-zhoucang', 'pikeman')
  await clickBtn(page, 'transfer-hero-swordsman-1')
  await page.waitForFunction(
    () =>
      (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrison?.some(
        (u) => u.defId === 'swordsman' && u.count === 1
      )
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrison).toEqual([{ defId: 'swordsman', count: 1 }])
  expect(armyOf(s, 'g-guan', 'swordsman')).toBe(guanSwordsBefore - 1)
  expect(armyOf(s, 'g-zhoucang', 'pikeman')).toBe(zhouPikeBefore)
  // 反向移兵回驻城英雄
  await clickBtn(page, 'transfer-garrison-swordsman-1')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrison?.length === 0
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrison).toEqual([])
  expect(armyOf(s, 'g-guan', 'swordsman')).toBe(guanSwordsBefore)

  // ⑥ 交换 → 互换（双槽）：garrison↔visitor + heroes 成员切换
  await clickBtn(page, 'swap')
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.towns?.[0]?.garrisonGeneralId === 'g-zhoucang' && st?.towns?.[0]?.visitorGeneralId === 'g-guan'
  })
  s = await readState(page)
  expect(s.towns?.[0]?.garrisonGeneralId).toBe('g-zhoucang')
  expect(s.towns?.[0]?.visitorGeneralId).toBe('g-guan')
  // 互换后 heroes 成员切换：原驻城关羽回 heroes（位置=城格），原访问周仓进 garrison 移除
  expect(s.heroes?.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 0 })
  expect(s.heroes?.some((h) => h.generalId === 'g-zhoucang')).toBe(false)

  // 截图交人工目检：交换后的面板（驻城=周仓、访问=关羽）
  await page.screenshot({ path: 'screenshots/town-panel-swap.png' })
})

test('城池面板：交换单槽（只有访问点交换=进驻）', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  // ① 关羽进城（访问，仍在地图上）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await clickTownAndEnter(page, 'g-guan')
  let s = await readState(page)
  expect(s.heroes?.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 0 })

  // ② 打开面板 → 点交换 → 访问进驻（移入 garrison，从 heroes 移除）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await openPanel(page)
  await clickBtn(page, 'swap')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrisonGeneralId === 'g-guan'
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrisonGeneralId).toBe('g-guan')
  expect(s.towns?.[0]?.visitorGeneralId).toBeNull()
  expect(s.heroes?.some((h) => h.generalId === 'g-guan')).toBe(false) // 进驻 → 从 heroes 移除
})

test('城池面板：交换单槽（只有驻城点交换=出城）', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  // ① 关羽进城（访问）→ 驻守（garrison=关羽，从 heroes 移除）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await clickTownAndEnter(page, 'g-guan')
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await openPanel(page)
  await clickBtn(page, 'garrison')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrisonGeneralId === 'g-guan'
  )
  let s = await readState(page)
  expect(s.heroes?.some((h) => h.generalId === 'g-guan')).toBe(false)

  // ② 点交换（只有驻城）→ 驻城武将出城：garrison 清空，回 heroes 位置=城格
  await clickBtn(page, 'swap')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.heroes?.some((h) => h.generalId === 'g-guan')
  )
  s = await readState(page)
  expect(s.towns?.[0]?.garrisonGeneralId).toBeNull()
  expect(s.towns?.[0]?.visitorGeneralId).toBeNull()
  expect(s.heroes?.find((h) => h.generalId === 'g-guan')?.position).toEqual({ q: 0, r: 0 })
})
