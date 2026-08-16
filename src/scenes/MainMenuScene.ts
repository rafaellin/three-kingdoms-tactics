import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { BattleScene } from './BattleScene'
import { getBgmManager } from '../audio/BgmManager'
import { COLORS, css, FONT_DISPLAY, FONT_SEAL } from '../ui/theme'
import { makeButton } from '../ui/button'
import { fadeAndStart, fadeIn } from '../ui/fade'

/**
 * 主菜单（渲染层）三入口：探索测试 → 大地图（探索模式）；开始战役 → 大地图（战役模式，传 campaignId）；
 * 战斗测试 → 战斗场景。探索/战役入口经 fadeAndStart 携带 data 传给 AdventureScene 的 create(data)。
 * 标题用书法 display 字体 + 右侧朱砂印（程序化 Graphics，无需美术）；
 * 按钮用共享 makeButton（hover/pressed 两态 + 统一宽度）。
 * 淡入动画完成后按钮才可点（点击回调经 buttonsEnabled 守卫，避免动画期间误点）。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenu'
  /** 朱砂印边长（px） */
  private static readonly SEAL_SIZE = 66
  /** 标题与印章的间距（px） */
  private static readonly TITLE_SEAL_GAP = 24
  private buttonsEnabled = false
  private title!: Phaser.GameObjects.Text
  private sealGraphics!: Phaser.GameObjects.Graphics
  private sealText!: Phaser.GameObjects.Text
  private startBtn!: Phaser.GameObjects.Text
  private campaignBtn!: Phaser.GameObjects.Text
  private battleBtn!: Phaser.GameObjects.Text

  constructor() {
    super(MainMenuScene.KEY)
  }

  create(): void {
    const bgm = getBgmManager(this)
    if (bgm.getState().currentCategory !== 'menu') {
      bgm.switchToCategory('menu')
    }
    this.cameras.main.setBackgroundColor(css(COLORS.nightInk))
    fadeIn(this)
    const { width, height } = this.scale
    // 标题：书法 display 字体（先占位，稍后与印章整体居中）
    this.title = this.add
      .text(width / 2, height * 0.3, '三国志：战术传说', {
        fontFamily: FONT_DISPLAY,
        fontSize: '64px',
        color: css(COLORS.parchment)
      })
      .setOrigin(0.5)
      .setAlpha(0)
    // 朱砂印：毛边红描边框 + 红字「戰」（程序化）
    this.createSeal()
    // 标题 + 印章整体水平居中
    this.positionTitle()
    this.startBtn = this.createButton(width / 2, height * 0.5, '探索测试', () => {
      if (this.buttonsEnabled) fadeAndStart(this, AdventureScene.KEY, { mode: 'explore', campaignId: 'dongling' })
    })
    this.campaignBtn = this.createButton(width / 2, height * 0.63, '开始战役', () => {
      if (this.buttonsEnabled) fadeAndStart(this, AdventureScene.KEY, { mode: 'campaign', campaignId: 'dongling' })
    })
    this.battleBtn = this.createButton(width / 2, height * 0.76, '战斗测试', () => {
      if (this.buttonsEnabled) fadeAndStart(this, BattleScene.KEY)
    })
    // 标题 + 印章 + 按钮一起淡入；动画完成才放行点击
    this.tweens.add({
      targets: [this.title, this.sealGraphics, this.sealText, this.startBtn, this.campaignBtn, this.battleBtn],
      alpha: 1,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.buttonsEnabled = true
      }
    })
    // resize：标题/印章/按钮按新窗口重新定位（相对比例）
    this.scale.on('resize', () => this.reposition())
  }

  /**
   * 朱砂印（红描边毛边方框 + 红字「戰」，无填充——像印章盖在纸上的效果）：位置跟随标题右侧。
   * 毛边 = 框沿按固定种子 RNG 抖动（模拟印章压印的不规则边）；「戰」用霞鹜文楷子集（马善政 GB2312 无繁体）。
   */
  private createSeal(): void {
    const S = MainMenuScene.SEAL_SIZE
    const rng = new Phaser.Math.RandomDataGenerator(['seal-edge'])
    this.sealGraphics = this.add.graphics().setAlpha(0)
    this.sealGraphics.lineStyle(2, COLORS.cinnabar, 1)
    this.sealGraphics.strokePoints(this.roughSquarePoints(S, 2, rng), true)
    this.sealText = this.add
      .text(0, 0, '戰', {
        fontFamily: FONT_SEAL,
        fontSize: '40px',
        color: css(COLORS.cinnabar)
      })
      .setOrigin(0.5)
      .setAlpha(0)
    this.positionSeal()
  }

  /** 毛边方形轮廓点：每边 5 段、各点沿法线方向用固定种子 RNG 抖动（确定性，截图不漂移） */
  private roughSquarePoints(size: number, jitter: number, rng: Phaser.Math.RandomDataGenerator): Phaser.Math.Vector2[] {
    const half = size / 2
    const seg = 5
    const step = size / seg
    const j = (): number => rng.frac() * jitter * 2 - jitter
    const pts: Phaser.Math.Vector2[] = []
    // 上边（从左→右）
    for (let i = 0; i <= seg; i++) pts.push(new Phaser.Math.Vector2(-half + i * step, -half + j()))
    // 右边（从上→下）
    for (let i = 1; i <= seg; i++) pts.push(new Phaser.Math.Vector2(half + j(), -half + i * step))
    // 下边（从右→左）
    for (let i = 1; i <= seg; i++) pts.push(new Phaser.Math.Vector2(half - i * step, half + j()))
    // 左边（从下→上）
    for (let i = 1; i <= seg; i++) pts.push(new Phaser.Math.Vector2(-half + j(), half - i * step))
    return pts
  }

  /** 标题 + 印章整体水平居中：左 = (屏宽 - 总宽)/2，标题 y 固定 0.3 */
  private positionTitle(): void {
    const { width, height } = this.scale
    const totalW =
      this.title.width + MainMenuScene.TITLE_SEAL_GAP + MainMenuScene.SEAL_SIZE
    this.title.setPosition((width - totalW) / 2 + this.title.width / 2, height * 0.3)
    this.positionSeal()
  }

  /** 印章中心 = 标题右缘 + 间隙，与标题同高 */
  private positionSeal(): void {
    const x =
      this.title.x + this.title.width / 2 + MainMenuScene.TITLE_SEAL_GAP + MainMenuScene.SEAL_SIZE / 2
    const y = this.title.y
    this.sealGraphics.setPosition(x, y)
    this.sealText.setPosition(x, y)
  }

  /** 共享按钮：统一宽度 280px（三按钮等宽），字号 28px；淡入前 alpha 0 */
  private createButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    return makeButton(this, x, y, label, onClick, { fontSize: 28, minWidth: 280 }).setAlpha(0)
  }

  /** 窗口变化时按新尺寸重排（相对比例居中；标题+印章整体居中） */
  private reposition(): void {
    const { width, height } = this.scale
    if (this.title) this.positionTitle()
    this.startBtn?.setPosition(width / 2, height * 0.5)
    this.campaignBtn?.setPosition(width / 2, height * 0.63)
    this.battleBtn?.setPosition(width / 2, height * 0.76)
  }

  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'menu',
      menu: {
        buttonsEnabled: this.buttonsEnabled,
        buttons: [
          { label: '探索测试', x: this.startBtn?.x, y: this.startBtn?.y },
          { label: '开始战役', x: this.campaignBtn?.x, y: this.campaignBtn?.y },
          { label: '战斗测试', x: this.battleBtn?.x, y: this.battleBtn?.y }
        ]
      },
      bgm: getBgmManager(this).getState()
    }
  }
}
