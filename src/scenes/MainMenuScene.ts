import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { BattleScene } from './BattleScene'

/**
 * 主菜单（渲染层）：开始游戏 → 大地图；战斗测试 → 战斗场景。
 * 按钮为视口固定坐标（1920×1080 设计基准；RESIZE 下按当前宽高居中）。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenu'

  constructor() {
    super(MainMenuScene.KEY)
  }

  create(): void {
    const { width, height } = this.scale
    this.cameras.main.setBackgroundColor('#0f1622')
    this.add
      .text(width / 2, height * 0.3, '三国志：战术传说', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#f5f2e8'
      })
      .setOrigin(0.5)
    this.makeButton(width / 2, height * 0.55, '开始游戏', () => this.scene.start(AdventureScene.KEY))
    this.makeButton(width / 2, height * 0.68, '战斗测试', () => this.scene.start(BattleScene.KEY))
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, label, {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setPadding(24, 12)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerdown', onClick)
  }
}
