import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { BattleScene } from './BattleScene'

/**
 * 主菜单（渲染层）：开始游戏 → 大地图；战斗测试 → 战斗场景。
 * 淡入动画完成后按钮才可点（避免动画期间误点）。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenu'
  private buttonsEnabled = false

  constructor() {
    super(MainMenuScene.KEY)
  }

  create(): void {
    const { width, height } = this.scale
    this.cameras.main.setBackgroundColor('#0f1622')
    const title = this.add
      .text(width / 2, height * 0.3, '三国志：战术传说', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#f5f2e8'
      })
      .setOrigin(0.5)
      .setAlpha(0)
    const startBtn = this.makeButton(width / 2, height * 0.55, '开始游戏')
    const battleBtn = this.makeButton(width / 2, height * 0.68, '战斗测试')
    this.tweens.add({
      targets: [title, startBtn, battleBtn],
      alpha: 1,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.buttonsEnabled = true
        startBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(AdventureScene.KEY))
        battleBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(BattleScene.KEY))
      }
    })
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
    return { ready: true, scene: 'menu', menu: { buttonsEnabled: this.buttonsEnabled } }
  }
}
