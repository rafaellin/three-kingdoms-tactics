import Phaser from 'phaser'
import type { BattleState, Side } from '../core/battle/types'
import { COLORS, css, FONT_DISPLAY } from './theme'

const CARD_W = 216
const EDGE = 16      // 屏幕边缘留白
const PAD = 16       // 面板内边距

/**
 * 战斗武将卡（渲染层，纯显示）。
 * 左=攻方(player)贴左缘、右=守方(enemy)贴右缘，垂直居中；setScrollFactor(0) 不随相机平移。
 * 内容：武将名 + 当前六维 + 蓝量 + 被动技能，全部派生自 state.general[side]。
 * 窄视口下卡可能与战场边缘重叠（MVP 接受；1920 设计基准下左右边距 ~490px 放得下）。
 */
export class GeneralCard {
  private readonly bg: Phaser.GameObjects.Graphics
  private readonly nameText: Phaser.GameObjects.Text
  private readonly body: Phaser.GameObjects.Text
  private lastState: BattleState | null = null

  constructor(private readonly scene: Phaser.Scene, private readonly side: Side) {
    this.bg = scene.add.graphics().setDepth(11).setScrollFactor(0)
    this.nameText = scene.add
      .text(0, 0, '', { fontFamily: FONT_DISPLAY, fontSize: '28px', fontStyle: 'bold', color: css(COLORS.gilt) })
      .setDepth(12)
      .setScrollFactor(0)
    this.body = scene.add
      .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '16px', color: css(COLORS.parchment), lineSpacing: 6 })
      .setDepth(12)
      .setScrollFactor(0)
    scene.scale.on('resize', this.onResize)
  }

  render(state: BattleState): void {
    this.lastState = state
    const gen = state.general[this.side]
    this.nameText.setText(gen.name)
    this.body.setText(
      [
        `武力 ${gen.stats.atk}    统御 ${gen.stats.def}`,
        `智力 ${gen.stats.int}    政治 ${gen.stats.pol}`,
        `魅力 ${gen.stats.cha}    等级 ${gen.level}`,
        `蓝量 ${gen.currentMana}/${gen.maxMana}`,
        ...(gen.passives.length > 0
          ? gen.passives.map((p) => `被动 ${p.name} Lv${p.level}`)
          : ['被动 —'])
      ].join('\n')
    )
    this.layout()
  }

  /** 卡体可见文本（e2e 断言用；纯派生自 state.general） */
  getDebugText(): string {
    return `${this.nameText.text}\n${this.body.text}`
  }

  setVisible(visible: boolean): void {
    this.bg.setVisible(visible)
    this.nameText.setVisible(visible)
    this.body.setVisible(visible)
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize)
    this.bg.destroy()
    this.nameText.destroy()
    this.body.destroy()
  }

  private readonly onResize = (): void => {
    // render 内部会再次 layout（定位依赖最新相机尺寸），无需重复调用
    if (this.lastState) this.render(this.lastState)
  }

  /** 定位 + 画面板：左卡从 x=EDGE 向右展开，右卡从 cam.width-EDGE 向左展开；垂直居中 */
  private layout(): void {
    const cam = this.scene.cameras.main
    const y = cam.height / 2
    const bodyH = this.body.height
    const cardH = this.nameText.height + 6 + bodyH + PAD * 2
    const leftX = EDGE
    const rightX = cam.width - EDGE - CARD_W
    const x0 = this.side === 'player' ? leftX : rightX
    this.bg.clear()
    this.bg.fillStyle(COLORS.nightInk, 0.82)
    this.bg.fillRoundedRect(x0, y - cardH / 2, CARD_W, cardH, 8)
    this.bg.lineStyle(2, COLORS.gilt, 0.6)
    this.bg.strokeRoundedRect(x0, y - cardH / 2, CARD_W, cardH, 8)
    const originX = this.side === 'player' ? 0 : 1
    this.nameText.setOrigin(originX, 0.5).setPosition(x0 + (originX === 0 ? PAD : CARD_W - PAD), y - cardH / 2 + this.nameText.height / 2)
    this.body.setOrigin(originX, 0).setPosition(x0 + (originX === 0 ? PAD : CARD_W - PAD), y - cardH / 2 + this.nameText.height + 6)
  }
}
