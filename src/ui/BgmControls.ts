import Phaser from 'phaser'
import type { BgmManager } from '../audio/BgmManager'

/** 创建控件时对每个 Phaser 对象执行的回调（Adventure 传 uiOnly 归入 UI 相机；Battle 不传） */
export interface BgmControlsHooks {
  onCreateObject?: <T extends Phaser.GameObjects.GameObject>(obj: T) => T
}

/**
 * BGM 播放控件（渲染层共享组件）：上一首 / 曲名 / 下一首 / 音量按钮 + 音量滑块。
 * 右上角固定（右对齐整行），scrollFactor(0) 不随相机缩放——底部让位给战斗行动顺序条 / 未来状态条。
 * destroy() 注销 BGM 曲目监听与 resize 监听（Phaser 对象随场景 shutdown 自动销毁）。
 */
export class BgmControls {
  private static readonly SLIDER_W = 120
  private static readonly SLIDER_H = 8
  /** 右上角边距（px）：右缘留白 / 顶缘留白（与 Battle logText 顶缘 24 对齐） */
  private static readonly TOP_X = 40
  private static readonly TOP_Y = 24
  /** 按钮水平间距（px） */
  private static readonly GAP = 6

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
    const btnStyle = { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', backgroundColor: '#33415c' }
    const labelStyle = { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff', backgroundColor: '#1a1f2e' }

    // 统一右上角布局：先以 (0,0) 占位创建，末尾 refresh() → repositionRow() 右对齐排布
    this.prevBtn = wrap(scene.add.text(0, 0, '<', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.label = wrap(scene.add.text(0, 0, '', labelStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8))
    this.nextBtn = wrap(scene.add.text(0, 0, '>', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    this.volumeBtn = wrap(scene.add.text(0, 0, '\u{1F50A}', btnStyle).setDepth(12).setScrollFactor(0).setPadding(14, 8).setInteractive({ useHandCursor: true }))
    // 滑块：位置由 repositionRow() 统一排布（从音量钮向左展开，避免顶出屏幕右缘）
    this.slider = wrap(scene.add.graphics().setPosition(0, 0).setDepth(13).setScrollFactor(0).setVisible(false))

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

  /** 右上角右对齐整行（Text origin 均为 (0,0)：x/y = 左上角）。滑块从音量钮向左展开，避免顶出屏幕右缘。 */
  private readonly repositionRow = (): void => {
    const cam = this.scene.cameras.main
    const right = cam.width - BgmControls.TOP_X
    const y = BgmControls.TOP_Y
    this.volumeBtn.setPosition(right - this.volumeBtn.width, y)
    this.nextBtn.setPosition(this.volumeBtn.x - BgmControls.GAP - this.nextBtn.width, y)
    this.label.setPosition(this.nextBtn.x - BgmControls.GAP - this.label.width, y)
    this.prevBtn.setPosition(this.label.x - BgmControls.GAP - this.prevBtn.width, y)
    this.slider.setPosition(this.volumeBtn.x - 8 - BgmControls.SLIDER_W, this.volumeBtn.y + 12)
  }

  private readonly onResize = (): void => {
    this.repositionRow()
    if (this.sliderVisible) this.drawSlider()
  }

  /** 刷新曲名 / 音量图标 / 滑块位置（切歌、播放状态、音量变化时调用） */
  refresh(): void {
    const track = this.bgm.getCurrentTrack()
    const playing = this.bgm.getState().playing
    this.label.setText(track && playing ? `\u{266A} ${track}` : '')
    const v = this.bgm.getVolume()
    if (v <= 0) this.volumeBtn.setText('\u{1F507}')       // 🔇
    else if (v <= 0.33) this.volumeBtn.setText('\u{1F508}') // 🔈
    else if (v <= 0.66) this.volumeBtn.setText('\u{1F509}') // 🔉
    else this.volumeBtn.setText('\u{1F50A}')                // 🔊
    this.repositionRow() // 曲名 / 音量图标宽度变化后重新右对齐
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
