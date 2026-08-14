import Phaser from 'phaser'
import { computeBail } from '../core/battle/result'
import type { BattleState } from '../core/battle/types'

export interface BattleActionButtonsCallbacks {
  onSurrender(): void
  onFlee(): void
  onNegotiate(): void
  onSkill(): void
  onWait(): void
  onDefend(): void
}

export type ActionButtonKey = 'settings' | 'surrender' | 'flee' | 'negotiate' | 'skill' | 'wait' | 'defend'

const BTN_W = 80
const BTN_H = 80
const GAP = 8
const PAD = 12

/**
 * 战斗底部行动条两侧按钮组（渲染层）：左=⚙/降/逃/和、右=技/候/守。
 * 布局：左组从左缘排开，右组贴右缘；中间留白给 TurnOrderQueue（getLeftWidth/getRightWidth 提供）。
 * disabled 用 setAlpha(0.4)+灰字表达（点击回调仍触发，场景侧守卫 canAct 兜底）。
 * ⚙ 为 Unicode 占位（用户确认），将来换图标。
 */
export class BattleActionButtons {
  private readonly left: Phaser.GameObjects.Text[] = []   // ⚙ / 降 / 逃 / 和
  private readonly right: Phaser.GameObjects.Text[] = []  // 技 / 候 / 守
  private readonly tooltip: Phaser.GameObjects.Text
  private enabled: boolean[] = []

  constructor(private readonly scene: Phaser.Scene, private readonly cb: BattleActionButtonsCallbacks) {
    this.tooltip = scene.add
      .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)' })
      .setDepth(15)
      .setScrollFactor(0)
      .setVisible(false)
    const mkBtn = (label: string, onClick: () => void): Phaser.GameObjects.Text =>
      scene.add
        .text(0, 0, label, { fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff', backgroundColor: '#33415c', fixedWidth: BTN_W, align: 'center' })
        .setOrigin(0, 0.5)
        .setPadding(0, 22)
        .setDepth(12)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onClick())
    const leftSpecs = [
      { label: '⚙', onClick: () => {} },                                   // 设置（占位，禁用）
      { label: '降', onClick: () => this.cb.onSurrender() },
      { label: '逃', onClick: () => this.cb.onFlee() },
      { label: '和', onClick: () => this.cb.onNegotiate() }
    ]
    const rightSpecs = [
      { label: '技', onClick: () => this.cb.onSkill() },
      { label: '候', onClick: () => this.cb.onWait() },
      { label: '守', onClick: () => this.cb.onDefend() }
    ]
    leftSpecs.forEach((s) => this.left.push(mkBtn(s.label, s.onClick)))
    rightSpecs.forEach((s) => this.right.push(mkBtn(s.label, s.onClick)))
    // 降/逃/和/技/候/守 hover 提示（技/候/守 附快捷键）
    const tooltips: Record<string, string> = { 降: '投降', 逃: '逃跑', 和: '议和', 技: '技能 (c)', 候: '等待 (w)', 守: '防御 (d)' }
    for (const b of [...this.left.slice(1), ...this.right]) {
      b.on('pointerover', () => {
        const tip = tooltips[b.text]
        if (tip && this.enabled[this.all().indexOf(b)] !== false) {
          this.tooltip.setText(tip).setPosition(b.x + b.width / 2, this.barY() - BTN_H - 4).setVisible(true)
        }
      })
      b.on('pointerout', () => this.tooltip.setVisible(false))
    }
    this.reposition()
    scene.scale.on('resize', this.onResize)
  }

  private barY(): number {
    return this.scene.cameras.main.height - 44
  }

  /** resize 处理（命名箭头函数，保证 on/off 引用一致可注销） */
  private readonly onResize = (): void => this.reposition()

  /** 布局：左组从左缘、右组贴右缘排开，y=条中心；构造与 resize 都调用 */
  private reposition(): void {
    const y = this.barY()
    const rightW = this.getRightWidth()
    for (let i = 0; i < this.left.length; i++) this.left[i]!.setPosition(PAD + i * (BTN_W + GAP), y)
    for (let i = 0; i < this.right.length; i++) {
      const x = this.scene.cameras.main.width - rightW + PAD + i * (BTN_W + GAP)
      this.right[i]!.setPosition(x, y)
    }
  }

  private all(): Phaser.GameObjects.Text[] {
    return [...this.left, ...this.right]
  }

  /** 状态变化时调用：刷新各按钮可用性（议和=金足且非野怪；候=当前未等待） */
  render(state: BattleState, canAct: boolean): void {
    const current = state.units.find((u) => u.id === state.currentUnitId)
    const notWaited = current ? !state.waitQueue.includes(current.id) : false
    const enter = state.enter
    const affordable = enter ? enter.playerGold >= computeBail(state) && enter.opponentKind !== 'wild' : false
    this.enabled = [false, canAct, canAct, canAct && affordable, canAct, canAct && notWaited, canAct]
    this.all().forEach((b, i) => {
      const on = this.enabled[i] === true
      b.setAlpha(on ? 1 : 0.4)
      b.setStyle({ color: on ? '#ffffff' : '#8a8f98' })
    })
  }

  getLeftWidth(): number {
    return PAD * 2 + this.left.length * BTN_W + (this.left.length - 1) * GAP
  }
  getRightWidth(): number {
    return PAD * 2 + this.right.length * BTN_W + (this.right.length - 1) * GAP
  }
  /** 各按钮中心坐标（debug / e2e 断言用；origin 左锚 → 中心 x = b.x + BTN_W/2，y = b.y 即垂直中心） */
  getCenters(): { key: ActionButtonKey; x: number; y: number }[] {
    const keys: ActionButtonKey[] = ['settings', 'surrender', 'flee', 'negotiate', 'skill', 'wait', 'defend']
    return this.all().map((b, i) => ({ key: keys[i] as ActionButtonKey, x: b.x + BTN_W / 2, y: b.y }))
  }
  setVisible(v: boolean): void {
    for (const b of this.all()) b.setVisible(v)
    this.tooltip.setVisible(false)
  }
  destroy(): void {
    this.scene.scale.off('resize', this.onResize)
    for (const b of this.all()) b.destroy()
    this.tooltip.destroy()
  }
}
