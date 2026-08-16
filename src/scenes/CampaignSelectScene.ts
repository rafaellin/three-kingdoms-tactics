import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { MainMenuScene } from './MainMenuScene'
import { listCampaigns } from '../data/campaigns'
import { COLORS, css, FONT_DISPLAY } from '../ui/theme'
import { makeButton } from '../ui/button'
import { fadeAndStart, fadeIn } from '../ui/fade'

/**
 * 战役选择界面（渲染层）：「开始战役」的下一步——列出所有可用战役，选择 → 进 AdventureScene。
 * 最终形态入口：主菜单「开始战役」→ 本场景 → 选战役 → Adventure { session: { kind:'campaign' } }。
 */
export class CampaignSelectScene extends Phaser.Scene {
  static readonly KEY = 'CampaignSelect'

  private buttonsEnabled = false
  private title!: Phaser.GameObjects.Text
  private buttons: { label: string; x: number; y: number; target: Phaser.GameObjects.Text }[] = []
  private backBtn!: Phaser.GameObjects.Text

  constructor() {
    super(CampaignSelectScene.KEY)
  }

  create(): void {
    this.cameras.main.setBackgroundColor(css(COLORS.nightInk))
    fadeIn(this)
    const { width, height } = this.scale
    this.title = this.add
      .text(width / 2, height * 0.28, '选择战役', {
        fontFamily: FONT_DISPLAY,
        fontSize: '56px',
        color: css(COLORS.gilt)
      })
      .setOrigin(0.5)
      .setAlpha(0)
    // 战役列表（每战役一按钮；后续新增战役只改数据注册表，这里自动列出）
    const campaigns = listCampaigns()
    const startY = height * 0.45
    const gap = 96
    const objs: Phaser.GameObjects.GameObject[] = [this.title]
    this.buttons = campaigns.map((c, i) => {
      const btn = this.createButton(width / 2, startY + i * gap, c.name, () => {
        if (this.buttonsEnabled) {
          fadeAndStart(this, AdventureScene.KEY, { session: { kind: 'campaign', campaignId: c.id } })
        }
      })
      objs.push(btn)
      return { label: c.name, x: btn.x, y: btn.y, target: btn }
    })
    this.backBtn = this.createButton(width / 2, startY + campaigns.length * gap, '返回主菜单', () => {
      if (this.buttonsEnabled) fadeAndStart(this, MainMenuScene.KEY)
    })
    objs.push(this.backBtn)
    // 一起淡入；动画完成才放行点击
    this.tweens.add({
      targets: objs,
      alpha: 1,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.buttonsEnabled = true
      }
    })
    this.scale.on('resize', () => this.reposition())
  }

  /** 共享按钮：统一宽度 360px，字号 26px；淡入前 alpha 0 */
  private createButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    return makeButton(this, x, y, label, onClick, { fontSize: 26, minWidth: 360 }).setAlpha(0)
  }

  /** 窗口变化时按新尺寸重排（相对比例） */
  private reposition(): void {
    const { width, height } = this.scale
    this.title?.setPosition(width / 2, height * 0.28)
    const startY = height * 0.45
    const gap = 96
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i]!.target.setPosition(width / 2, startY + i * gap)
    }
    this.backBtn?.setPosition(width / 2, startY + this.buttons.length * gap)
  }

  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'campaignSelect',
      buttonsEnabled: this.buttonsEnabled,
      campaigns: this.buttons.map((b) => ({ label: b.label, x: b.x, y: b.y })),
      back: this.backBtn ? { x: this.backBtn.x, y: this.backBtn.y } : null
    }
  }
}
