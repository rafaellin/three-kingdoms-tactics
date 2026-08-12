import Phaser from 'phaser'
import type { BgmManager } from '../audio/BgmManager'

/** 创建控件时对每个 Phaser 对象执行的回调（Adventure 传 uiOnly 归入 UI 相机；Battle 不传） */
export interface BgmControlsHooks {
  onCreateObject?: <T extends Phaser.GameObjects.GameObject>(obj: T) => T
}

/**
 * BGM 播放控件（渲染层共享组件）：上一首 / 曲名 / 下一首 / 音量按钮 + 音量滑块。
 * 左下角固定，scrollFactor(0) 不随相机缩放。
 * destroy() 注销 BGM 曲目监听与 resize 监听（Phaser 对象随场景 shutdown 自动销毁）。
 */
export class BgmControls {
  private static readonly SLIDER_W = 120
  private static readonly SLIDER_H = 8

  private readonly prevBtn: Phaser.GameObjects.Text
  private readonly label: Phaser.GameObjects.Text
  private readonly nextBtn: Phaser.GameObjects.Text
  private readonly volumeBtn: Phaser.GameObjects.Text
  private readonly slider: Phaser.GameObjects.Graphics
  private sliderVisible = false
  private sliderDragging = false
  private readonly onTrackChanged = (): void => this.refresh()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bgm: BgmManager,
    hooks?: BgmControlsHooks
  ) {
    const wrap = <T extends Phaser.GameObjects.GameObject>(obj: T): T =>
      hooks?.onCreateObject ? hooks.onCreateObject(obj) : obj
    const y = scene.cameras.main.height - 56
    const btnStyle = { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', backgroundColor: '#33415c' }
    const labelStyle = { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff', backgroundColor: '#1a1f2e' }

    this.prevBtn = wrap(scene.add.text(16, y, '<', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.label = wrap(scene.add.text(this.prevBtn.x + this.prevBtn.width + 6, y, '', labelStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8))
    this.nextBtn = wrap(scene.add.text(this.label.x + this.label.width + 6, y, '>', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.volumeBtn = wrap(scene.add.text(this.nextBtn.x + this.nextBtn.width + 6, y, '\u{1F50A}', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    // x=0 是临时占位，refresh() 中立即修正为 volumeBtn 右侧
    this.slider = wrap(scene.add.graphics().setPosition(0, y + 12).setDepth(13).setScrollFactor(0).setVisible(false))

    this.prevBtn.on('pointerdown', () => { this.bgm.prevTrack(); this.refresh() })
    this.nextBtn.on('pointerdown', () => { this.bgm.nextTrack(); this.refresh() })
    this.volumeBtn.on('pointerdown', () => this.toggleSlider())

    this.bgm.addTrackListener(this.onTrackChanged)
    this.scene.scale.on('resize', this.onResize)
    this.refresh()
  }

  /** 注销监听（场景 shutdown 时调用）；Phaser 对象由场景销毁 */
  destroy(): void {
    this.bgm.removeTrackListener(this.onTrackChanged)
    this.scene.scale.off('resize', this.onResize)
  }

  private readonly onResize = (): void => {
    const y = this.scene.cameras.main.height - 56
    this.prevBtn.setY(y)
    this.label.setY(y)
    this.nextBtn.setY(y)
    this.volumeBtn.setY(y)
    this.slider.setPosition(this.volumeBtn.x + this.volumeBtn.width + 8, y + 12)
    if (this.sliderVisible) this.drawSlider()
  }

  /** 刷新曲名 / 音量图标 / 滑块位置（切歌、播放状态、音量变化时调用） */
  refresh(): void {
    const track = this.bgm.getCurrentTrack()
    const playing = this.bgm.getState().playing
    this.label.setText(track && playing ? `\u{266A} ${track}` : '')
    this.label.setX(this.prevBtn.x + this.prevBtn.width + 6)
    this.nextBtn.setX(this.label.x + this.label.width + 6)
    this.volumeBtn.setX(this.nextBtn.x + this.nextBtn.width + 6)
    const v = this.bgm.getVolume()
    if (v <= 0) this.volumeBtn.setText('\u{1F507}')       // 🔇
    else if (v <= 0.33) this.volumeBtn.setText('\u{1F508}') // 🔈
    else if (v <= 0.66) this.volumeBtn.setText('\u{1F509}') // 🔉
    else this.volumeBtn.setText('\u{1F50A}')                // 🔊
    this.slider.setPosition(this.volumeBtn.x + this.volumeBtn.width + 8, this.volumeBtn.y + 12)
    this.drawSlider()
  }

  private toggleSlider(): void {
    this.sliderVisible = !this.sliderVisible
    if (this.sliderVisible) {
      this.slider.setVisible(true)
      const hitArea = new Phaser.Geom.Rectangle(0, -8, BgmControls.SLIDER_W, BgmControls.SLIDER_H + 16)
      this.slider.setInteractive({ hitArea, hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true })
      this.slider.on('pointerdown', this.sliderDownHandler)
      this.scene.input.on('pointermove', this.sliderMoveHandler)
      this.scene.input.on('pointerup', this.sliderUpHandler)
      this.scene.input.on('pointerupoutside', this.sliderUpHandler)
      this.drawSlider()
    } else {
      this.hideSlider()
    }
  }

  private hideSlider(): void {
    this.slider.setVisible(false)
    this.sliderDragging = false
    this.slider.removeInteractive()
    this.slider.off('pointerdown', this.sliderDownHandler)
    this.scene.input.off('pointermove', this.sliderMoveHandler)
    this.scene.input.off('pointerup', this.sliderUpHandler)
    this.scene.input.off('pointerupoutside', this.sliderUpHandler)
  }

  private readonly sliderDownHandler = (pointer: Phaser.Input.Pointer): void => {
    this.sliderDragging = true
    this.updateSliderFromPointer(pointer)
  }

  private readonly sliderUpHandler = (): void => { this.sliderDragging = false }

  private readonly sliderMoveHandler = (pointer: Phaser.Input.Pointer): void => {
    if (!this.sliderVisible || !this.sliderDragging) return
    this.updateSliderFromPointer(pointer)
  }

  /** 由指针计算滑块本地位置 → clamp → setVolume → 刷新（scrollFactor(0) 对象 .x 即屏幕坐标） */
  private updateSliderFromPointer(pointer: Phaser.Input.Pointer): void {
    const localX = pointer.x - this.slider.x
    const vol = Phaser.Math.Clamp(localX / BgmControls.SLIDER_W, 0, 1)
    this.bgm.setVolume(vol)
    this.refresh()
  }

  /** 重绘滑块：轨道背景 + 已选填充 + 手柄圆点 */
  private drawSlider(): void {
    const vol = this.bgm.getVolume()
    const W = BgmControls.SLIDER_W
    const H = BgmControls.SLIDER_H
    const fillW = Math.max(H, vol * W)
    const g = this.slider
    g.clear()
    g.fillStyle(0x1a1f2e, 1)
    g.fillRoundedRect(0, 0, W, H, H / 2)
    g.fillStyle(0x5a7ab0, 1)
    g.fillRoundedRect(0, 0, fillW, H, H / 2)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(fillW, H / 2, 7)
    g.lineStyle(1.5, 0x5a7ab0, 1)
    g.strokeCircle(fillW, H / 2, 7)
  }

  /** 供 dev bridge / e2e 断言控件存在与位置 */
  getDebugState(): Record<string, unknown> {
    return {
      present: true,
      prev: { x: this.prevBtn.x, y: this.prevBtn.y },
      next: { x: this.nextBtn.x, y: this.nextBtn.y },
      volume: { x: this.volumeBtn.x, y: this.volumeBtn.y },
      slider: { x: this.slider.x, y: this.slider.y },
      sliderVisible: this.sliderVisible
    }
  }
}
