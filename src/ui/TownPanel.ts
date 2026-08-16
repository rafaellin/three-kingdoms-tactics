import Phaser from 'phaser'
import { makeButton } from './button'
import { COLORS, css, FONT_DISPLAY } from './theme'
import { UNIT_DEFS } from '../data/units'
import type { FactionId, GameState, General, Town } from '../core/state/GameState'

/** 城池面板动作回调（由 AdventureScene 接线到 core 命令 + 刷新） */
export interface TownPanelActions {
  onGarrison(heroId: string): void
  onLeave(heroId: string): void
  onSwap(): void
  onTransfer(from: 'hero' | 'garrison', defId: string, count: number): void
}

/** 面板按钮（e2e 经 getDebugState 读坐标点击/断言） */
export interface TownPanelButtonDebug {
  key: string
  label: string
  x: number
  y: number
  enabled: boolean
}

const OWNER_NAMES: Record<FactionId, string> = { wei: '魏', shu: '蜀', wu: '吴', qun: '群' }
const UNIT_NAME = (defId: string): string => UNIT_DEFS[defId as keyof typeof UNIT_DEFS]?.name ?? defId

/**
 * 城池界面（渲染层组件，纯显示 + 输入转动作）。
 *
 * 内容：城名/等级/势力 + 驻军槽（兵种×数量）+ 驻城英雄卡 + 访问英雄卡 + 动作按钮。
 * 按钮按槽位占用动态出现：驻守（访问→驻城）/ 换将（驻城↔访问）/ 出城（回 heroes）；
 * 移兵：英雄 army ↔ 城驻军，每个兵种行带「1/全」两个小按钮，双向移动。
 *
 * 输入隔离铁律（与 Modal 同纪律，防泄漏到地图）：
 * - 全屏 overlay（interactive）挡住下方地图/HUD —— Phaser topOnly 只把事件派发给最上层交互对象，
 *   故 overlay 之下的一切（含地图全局输入）都被挡住；场景侧另有 townPanel 守卫兜底；
 * - 面板区域放一个透明的 interactive blocker（depth 高于 overlay），让「点面板内部」不算 overlay 外点 → 不误关；
 * - 只响应左键（p.button === 0）；
 * - 关闭路径（关闭钮 / overlay 外点）同步回调 onClose，场景借此设置 modalGestureLock 吞掉尾随 pointerup。
 *
 * 渲染层对象只由 UI 相机渲染（setScrollFactor(0) + 忽略主相机）→ 固定屏幕、不随地图缩放/滚动。
 */
export class TownPanel {
  private readonly scene: Phaser.Scene
  private readonly townId: string
  private readonly getState: () => GameState
  private readonly actions: TownPanelActions
  private readonly onClose: () => void

  private overlay: Phaser.GameObjects.Rectangle
  private overlayDown = false
  private content: Phaser.GameObjects.GameObject[] = []
  private debugButtons: TownPanelButtonDebug[] = []
  private closed = false

  constructor(scene: Phaser.Scene, townId: string, getState: () => GameState, actions: TownPanelActions, onClose: () => void) {
    this.scene = scene
    this.townId = townId
    this.getState = getState
    this.actions = actions
    this.onClose = onClose

    const cam = scene.cameras.main
    this.overlay = this.uiOnly(
      scene.add
        .rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.55)
        .setDepth(30)
        .setScrollFactor(0)
        .setInteractive()
    )
    this.overlay.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button === 0) this.overlayDown = true
    })
    this.overlay.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return
      if (this.overlayDown) {
        this.overlayDown = false
        this.close()
      }
    })

    this.render()
  }

  /** 动作 dispatch 后从最新 state 重绘面板 */
  refresh(): void {
    if (this.closed) return
    this.render()
  }

  /** 关闭：同步回调 onClose（场景借此重置输入状态），然后销毁全部对象 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.onClose()
    for (const o of this.content) o.destroy()
    this.content = []
    this.overlay.destroy()
  }

  /** e2e / dev 断言：面板当前内容 + 按钮坐标 */
  getDebugState(): Record<string, unknown> {
    const state = this.getState()
    const town = state.towns.find((t) => t.id === this.townId)
    if (!town) return { open: false }
    const generalOf = (id: string | null): General | undefined =>
      id ? state.generals.find((g) => g.id === id) : undefined
    const garrisonGeneral = generalOf(town.garrisonGeneralId)
    const visitorGeneral = generalOf(town.visitorGeneralId)
    return {
      open: true,
      townId: town.id,
      name: town.name,
      level: town.level,
      owner: town.owner,
      garrison: town.garrison,
      garrisonGeneralId: town.garrisonGeneralId,
      garrisonGeneralName: garrisonGeneral?.name ?? null,
      garrisonGeneralArmy: garrisonGeneral?.army ?? [],
      visitorGeneralId: town.visitorGeneralId,
      visitorGeneralName: visitorGeneral?.name ?? null,
      visitorGeneralArmy: visitorGeneral?.army ?? [],
      buttons: this.debugButtons
    }
  }

  // ---------- 渲染 ----------

  /** 只由 UI 相机渲染：忽略主相机（不随大地图缩放/滚动），固定屏幕 */
  private uiOnly<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.scene.cameras.main.ignore(obj)
    return obj
  }

  private addText(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    originX = 0,
    originY = 0.5
  ): Phaser.GameObjects.Text {
    const t = this.uiOnly(
      this.scene.add
        .text(x, y, text, style)
        .setOrigin(originX, originY)
        .setDepth(32)
        .setScrollFactor(0)
    )
    this.content.push(t)
    return t
  }

  private addButton(
    x: number,
    y: number,
    label: string,
    key: string,
    onClick: () => void,
    opts: { fontSize?: number; minWidth?: number; padding?: { x: number; y: number } }
  ): Phaser.GameObjects.Text {
    const btn = this.uiOnly(
      makeButton(this.scene, x, y, label, onClick, {
        fontSize: opts.fontSize ?? 16,
        minWidth: opts.minWidth ?? 40,
        padding: opts.padding
      }).setDepth(32).setScrollFactor(0)
    )
    this.content.push(btn)
    this.debugButtons.push({ key, label, x, y, enabled: true })
    return btn
  }

  private render(): void {
    for (const o of this.content) o.destroy()
    this.content = []
    this.debugButtons = []

    const scene = this.scene
    const state = this.getState()
    const town = state.towns.find((t) => t.id === this.townId)
    if (!town) {
      this.close()
      return
    }

    const cam = scene.cameras.main
    const cx = cam.width / 2
    const cy = cam.height / 2
    const W = 760
    const H = 680
    const x0 = cx - W / 2
    const y0 = cy - H / 2
    const left = x0 + 28
    const right = x0 + W - 28

    // 面板底
    const bg = this.uiOnly(scene.add.graphics().setDepth(31).setScrollFactor(0))
    bg.fillStyle(COLORS.nightInk, 0.96)
    bg.fillRoundedRect(x0, y0, W, H, 12)
    bg.lineStyle(2, COLORS.gilt, 1)
    bg.strokeRoundedRect(x0, y0, W, H, 12)
    this.content.push(bg)

    // 面板内部 blocker：interactive 且覆盖整个面板 → 点面板内部时它是最高层交互对象，
    // 不算 overlay 外点 → 不会误关面板（topOnly 只派发给它）
    const blocker = this.uiOnly(
      scene.add.rectangle(cx, cy, W, H, 0x000000, 0).setDepth(31).setScrollFactor(0).setInteractive()
    )
    this.content.push(blocker)

    // 标题
    this.addText(
      cx,
      y0 + 40,
      `${town.name}  Lv${town.level}  势力：${OWNER_NAMES[town.owner]}`,
      { fontFamily: FONT_DISPLAY, fontSize: '32px', color: css(COLORS.gilt) },
      0.5,
      0.5
    )

    // 关闭按钮（右上角）
    this.addButton(right - 52, y0 + 40, '✕', 'close', () => this.close(), { fontSize: 18, minWidth: 44, padding: { x: 12, y: 8 } })

    const generalOf = (id: string | null): General | undefined =>
      id ? state.generals.find((g) => g.id === id) : undefined
    // 移兵 actor 必须与 reducer 的 transferTroops 一致：garrison 优先（驻守武将的兵进出驻军）
    const actorId = town.garrisonGeneralId ?? town.visitorGeneralId
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      color: css(COLORS.parchment)
    }

    let y = y0 + 82

    // 驻军槽
    y = this.sectionHeader('驻军', left, y)
    if (town.garrison.length === 0) {
      y = this.emptyLine(left, y)
    } else {
      for (const u of town.garrison) {
        y = this.unitLine(left, y, `${UNIT_NAME(u.defId)} ×${u.count}`, textStyle, {
          // 英雄在城（驻守或访问）才可把驻军移回英雄
          from: 'garrison',
          defId: u.defId,
          count: u.count,
          active: Boolean(actorId),
          right
        })
      }
    }

    // 驻城英雄
    y += 14
    y = this.sectionHeader('驻城英雄', left, y)
    y = this.heroCard(left, y, right, generalOf(town.garrisonGeneralId), town, actorId === town.garrisonGeneralId, textStyle)

    // 访问英雄
    y += 14
    y = this.sectionHeader('访问英雄', left, y)
    y = this.heroCard(left, y, right, generalOf(town.visitorGeneralId), town, actorId === town.visitorGeneralId, textStyle)

    // 动作按钮（底部居中排开；按槽位占用动态出现）
    const actions: { key: string; label: string }[] = []
    if (town.visitorGeneralId) actions.push({ key: 'garrison', label: '驻守' })
    if (town.garrisonGeneralId && town.visitorGeneralId) actions.push({ key: 'swap', label: '换将' })
    if (town.garrisonGeneralId || town.visitorGeneralId) actions.push({ key: 'leave', label: '出城' })
    const ay = y0 + H - 46
    if (actions.length > 0) {
      const gap = 150
      const startX = cx - ((actions.length - 1) * gap) / 2
      actions.forEach((a, i) => {
        const bx = startX + i * gap
        this.addButton(bx, ay, a.label, a.key, () => this.dispatchAction(a.key), { fontSize: 20, minWidth: 116 })
      })
    }
  }

  private sectionHeader(text: string, x: number, y: number): number {
    this.addText(x, y, text, { fontFamily: 'sans-serif', fontSize: '20px', color: css(COLORS.gilt), fontStyle: 'bold' })
    return y + 26
  }

  private emptyLine(x: number, y: number): number {
    this.addText(x, y, '（无）', { fontFamily: 'sans-serif', fontSize: '16px', color: css(COLORS.slateAzure) })
    return y + 22
  }

  /** 英雄卡：名字+等级，随后 army 每队一行；isActor 时附「英雄→驻军」移兵按钮 */
  private heroCard(
    left: number,
    y: number,
    right: number,
    general: General | undefined,
    town: Town,
    isActor: boolean,
    textStyle: Phaser.Types.GameObjects.Text.TextStyle
  ): number {
    if (!general) return this.emptyLine(left, y)
    this.addText(left, y, `${general.name}  Lv${general.level}`, {
      fontFamily: 'sans-serif',
      fontSize: '19px',
      color: css(COLORS.parchment),
      fontStyle: 'bold'
    })
    y += 26
    if (general.army.length === 0) return this.emptyLine(left, y)
    for (const u of general.army) {
      y = this.unitLine(left, y, `${UNIT_NAME(u.defId)} ×${u.count}`, textStyle, {
        from: 'hero',
        defId: u.defId,
        count: u.count,
        active: isActor && Boolean(town.garrisonGeneralId || town.visitorGeneralId),
        right
      })
    }
    return y
  }

  /** 兵种行：名称×数量 + （active 时）「1 / 全」两个小按钮，双向移兵 */
  private unitLine(
    x: number,
    y: number,
    label: string,
    textStyle: Phaser.Types.GameObjects.Text.TextStyle,
    opt: { from: 'hero' | 'garrison'; defId: string; count: number; active: boolean; right: number }
  ): number {
    this.addText(x, y, label, textStyle)
    if (opt.active) {
      const keyPrefix = opt.from === 'hero' ? 'transfer-hero' : 'transfer-garrison'
      this.addButton(opt.right - 46, y, '1', `${keyPrefix}-${opt.defId}-1`, () => this.actions.onTransfer(opt.from, opt.defId, 1), {
        fontSize: 13,
        minWidth: 34,
        padding: { x: 8, y: 6 }
      })
      this.addButton(opt.right - 46 - 52, y, '全', `${keyPrefix}-${opt.defId}-all`, () =>
        this.actions.onTransfer(opt.from, opt.defId, opt.count), {
        fontSize: 13,
        minWidth: 34,
        padding: { x: 8, y: 6 }
      })
    }
    return y + 24
  }

  private dispatchAction(key: string): void {
    const state = this.getState()
    const town = state.towns.find((t) => t.id === this.townId)
    if (!town) return
    if (key === 'garrison' && town.visitorGeneralId) {
      this.actions.onGarrison(town.visitorGeneralId)
    } else if (key === 'swap') {
      this.actions.onSwap()
    } else if (key === 'leave') {
      const id = town.visitorGeneralId ?? town.garrisonGeneralId
      if (id) this.actions.onLeave(id)
    }
  }
}
