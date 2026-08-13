import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { BattleScene } from './BattleScene'
import { getBgmManager } from '../audio/BgmManager'

/**
 * 主菜单（渲染层）：开始游戏 → 大地图；战斗测试 → 战斗场景。
 * 淡入动画完成后按钮才可点（避免动画期间误点）。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenu'
  private buttonsEnabled = false
  private title!: Phaser.GameObjects.Text
  private startBtn!: Phaser.GameObjects.Text
  private battleBtn!: Phaser.GameObjects.Text

  constructor() {
    super(MainMenuScene.KEY)
  }

  create(): void {
    const bgm = getBgmManager(this)
    if (bgm.getState().currentCategory !== 'menu') {
      bgm.switchToCategory('menu')
    }
    this.cameras.main.setBackgroundColor('#0f1622')
    const { width, height } = this.scale
    this.title = this.add
      .text(width / 2, height * 0.3, '三国志：战术传说', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#f5f2e8'
      })
      .setOrigin(0.5)
      .setAlpha(0)
    this.startBtn = this.makeButton(width / 2, height * 0.55, '开始游戏')
    this.battleBtn = this.makeButton(width / 2, height * 0.68, '战斗测试')
    this.tweens.add({
      targets: [this.title, this.startBtn, this.battleBtn],
      alpha: 1,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.buttonsEnabled = true
        this.startBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(AdventureScene.KEY))
        this.battleBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(BattleScene.KEY))
      }
    })
    // resize：标题/按钮按新窗口重新定位（相对比例）
    this.scale.on('resize', () => this.reposition())
  }

  /** 窗口变化时按新尺寸重排标题与按钮（相对比例居中） */
  private reposition(): void {
    const { width, height } = this.scale
    this.title?.setPosition(width / 2, height * 0.3)
    this.startBtn?.setPosition(width / 2, height * 0.55)
    this.battleBtn?.setPosition(width / 2, height * 0.68)
  }

  private makeButton(x: number, y: number, label: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, label, {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setPadding(24, 12)
      .setOrigin(0.5)
      .setAlpha(0)
  }

  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'menu',
      menu: { buttonsEnabled: this.buttonsEnabled },
      bgm: getBgmManager(this).getState()
    }
  }
}
