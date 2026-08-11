import type Phaser from 'phaser'
import type { BgmManager } from '../audio/BgmManager'

/**
 * BGM 播放控制条（可复用 UI 组件）。
 *
 * 布局：`[<]  曲目名  [>]`，视口固定左下角。
 * 使用方式：
 *   const controls = new BgmControls(scene, bgm)
 *   场景销毁时调用 controls.destroy()
 */

const CTRL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'sans-serif',
  fontSize: '20px',
  color: '#ffffff',
  backgroundColor: '#33415c'
}

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'sans-serif',
  fontSize: '18px',
  color: '#ffffff',
  backgroundColor: '#1a1f2e'
}

/** 控件条 y 坐标（视口底部对齐 end turn 按钮） */
const CTRL_Y = 1080 - 56

export class BgmControls {
  private readonly prevBtn: Phaser.GameObjects.Text
  private readonly trackLabel: Phaser.GameObjects.Text
  private readonly nextBtn: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    private readonly bgm: BgmManager
  ) {
    // 上一首按钮
    this.prevBtn = scene.add
      .text(16, CTRL_Y, '<', CTRL_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(14, 8)
      .setInteractive({ useHandCursor: true })

    this.prevBtn.on('pointerdown', () => {
      bgm.prevTrack()
      this.refresh()
    })

    // 当前曲目名（紧跟 prev 按钮右侧）
    this.trackLabel = scene.add
      .text(this.prevBtn.x + this.prevBtn.width + 6, CTRL_Y, '', LABEL_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(14, 8)

    // 下一首按钮（紧跟 label 右侧）
    this.nextBtn = scene.add
      .text(this.trackLabel.x + this.trackLabel.width + 6, CTRL_Y, '>', CTRL_STYLE)
      .setOrigin(0, 0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(14, 8)
      .setInteractive({ useHandCursor: true })

    this.nextBtn.on('pointerdown', () => {
      bgm.nextTrack()
      this.refresh()
    })

    // 初始刷新（显示当前曲目或空）
    this.refresh()
  }

  /** 更新曲目标签并重排按钮位置（流式布局） */
  refresh(): void {
    const track = this.bgm.getCurrentTrack()
    const playing = this.bgm.getState().playing
    // 曲名太长时截断显示
    const label = track && playing ? track : ''
    this.trackLabel.setText(label)

    // 流式重排：prev → label → next
    const prevRight = this.prevBtn.x + this.prevBtn.width + 6
    this.trackLabel.setX(prevRight)
    this.nextBtn.setX(this.trackLabel.x + this.trackLabel.width + 6)
  }

  /** 销毁所有 UI 元素 */
  destroy(): void {
    this.prevBtn.destroy()
    this.trackLabel.destroy()
    this.nextBtn.destroy()
  }
}
