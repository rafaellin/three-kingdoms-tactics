import Phaser from 'phaser'
import type { CampaignIntro } from '../data/campaigns'
import type { SfxManager } from '../audio/SfxManager'
import { makeButton } from './button'
import { css, COLORS, FONT_DISPLAY } from './theme'

/** 正文换行宽度（px；< 面板宽，留边距，防宽度溢出） */
const BODY_W = 740
/** 正文可视区高度（px）；超出 → 滚动条 */
const BODY_VIEW_H = 300
/** 滚动条位置：正文可视区右侧间隙 */
const SCROLL_GAP = 12
/** 面板尺寸（居中） */
const PANEL_W = 820
const PANEL_H = 640

/**
 * 战役开场剧情 modal（渲染层）：全屏半透明遮罩挡地图输入 + 大面板显示 标题/文稿/任务目标，
 * 并播放旁白音频（与 BGM 叠加，不替换）。
 *
 * 正文用 `wordWrap.useAdvancedWrap`（按字符断行，兼容无空格中文，防宽度溢出面板）；
 * 高度超过可视区（BODY_VIEW_H）→ 右侧滚动条 + 滚轮滚动（正文区）+ 拖动滑块。
 * 窗口 resize 时整组元素按新相机中心重定位（layout()）。
 *
 * 按钮状态：朗读中「跳过」→ 点跳过或朗读自然结束 → 变「开始」→ 点「开始」才进入游戏（onStart）。
 *
 * 输入隔离：遮罩 interactive（depth30）挡住地图；AdventureScene 用 introModalOpen 守卫屏蔽
 * 场景级输入（拖拽/点击/E/H/滚轮缩放），本组件自行处理滚轮（正文区滚动）。
 */
export class CampaignIntroModal {
  private readonly created: Phaser.GameObjects.GameObject[] = []
  /** 当前旁白音频实例（可中途 stop；null = 未就绪 / 已结束） */
  private narration: Phaser.Sound.BaseSound | null = null
  /** 按钮阶段：'skip' 朗读中（点=跳过）；'start' 已结束（点=开始游戏） */
  private phase: 'skip' | 'start' = 'skip'
  private destroyed = false

  private readonly cam: Phaser.Cameras.Scene2D.Camera
  private readonly overlay: Phaser.GameObjects.Rectangle
  private readonly panel: Phaser.GameObjects.Rectangle
  private readonly title: Phaser.GameObjects.Text
  private readonly body: Phaser.GameObjects.Text
  private readonly objective: Phaser.GameObjects.Text
  private readonly button: Phaser.GameObjects.Text
  private readonly track: Phaser.GameObjects.Rectangle | null
  private readonly thumb: Phaser.GameObjects.Rectangle | null
  private readonly zone: Phaser.GameObjects.Zone | null

  /** 正文全高（未裁剪时） */
  private readonly bodyFullH: number
  /** 最大滚动量（0 = 内容不超高，无滚动条） */
  private readonly maxScroll: number
  /** 当前滚动量（0 ~ maxScroll） */
  private scrollY = 0
  private readonly thumbH: number
  /** 拖动监听（destroy 时移除） */
  private readonly onThumbDrag: (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => void
  /** 窗口 resize → 整组重定位 */
  private readonly onResize: () => void

  constructor(
    private readonly scene: Phaser.Scene,
    intro: CampaignIntro,
    sfx: SfxManager,
    private readonly onStart: () => void
  ) {
    this.cam = scene.cameras.main
    this.overlay = scene.add
      .rectangle(0, 0, 1, 1, 0x000000, 0.55)
      .setDepth(30)
      .setScrollFactor(0)
      .setInteractive()
    this.created.push(this.overlay)
    this.panel = scene.add
      .rectangle(0, 0, PANEL_W, PANEL_H, COLORS.nightInk, 0.97)
      .setStrokeStyle(2, COLORS.gilt, 1)
      .setDepth(31)
      .setScrollFactor(0)
    this.created.push(this.panel)
    // 标题：display 书法字体（字体子集已含 战役标题用字；缺字会逐字回退 → 混排）
    this.title = scene.add
      .text(0, 0, intro.title, {
        fontFamily: FONT_DISPLAY,
        fontSize: '40px',
        color: css(COLORS.gilt),
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(32)
      .setScrollFactor(0)
    this.created.push(this.title)

    // 正文（位置/裁剪由 layout() 按相机中心 + scrollY 派生）
    this.body = scene.add
      .text(0, 0, intro.body, {
        fontFamily: 'sans-serif',
        fontSize: '19px',
        color: css(COLORS.parchment),
        align: 'center',
        lineSpacing: 12,
        // useAdvancedWrap：按字符断行（中文无空格也能换行，宽度不超 BODY_W → 防宽度溢出）
        wordWrap: { width: BODY_W, useAdvancedWrap: true }
      })
      .setOrigin(0.5, 0)
      .setDepth(32)
      .setScrollFactor(0)
    this.created.push(this.body)
    this.bodyFullH = this.body.height
    this.maxScroll = Math.max(0, this.bodyFullH - BODY_VIEW_H)
    this.thumbH = Math.max(24, Math.round(BODY_VIEW_H * (BODY_VIEW_H / this.bodyFullH)))

    // 内容超高 → 滚动条（轨道 + 滑块）+ 滚轮 zone；否则无滚动条
    let track: Phaser.GameObjects.Rectangle | null = null
    let thumb: Phaser.GameObjects.Rectangle | null = null
    let zone: Phaser.GameObjects.Zone | null = null
    if (this.maxScroll > 0) {
      track = scene.add
        .rectangle(0, 0, 4, BODY_VIEW_H, 0x445066, 0.7)
        .setDepth(33)
        .setScrollFactor(0)
      this.created.push(track)
      thumb = scene.add
        .rectangle(0, 0, 8, this.thumbH, COLORS.gilt, 0.9)
        .setDepth(33)
        .setScrollFactor(0)
        .setInteractive({ draggable: true, useHandCursor: true })
      this.created.push(thumb)
      zone = scene.add
        .zone(0, 0, BODY_W, BODY_VIEW_H)
        .setDepth(33)
        .setScrollFactor(0)
        .setInteractive()
      this.created.push(zone)
      zone.on('wheel', (_p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) =>
        this.scrollBy(dy)
      )
    }
    this.track = track
    this.thumb = thumb
    this.zone = zone

    this.objective = scene.add
      .text(0, 0, intro.objective, {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: css(COLORS.gilt),
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(32)
      .setScrollFactor(0)
    this.created.push(this.objective)
    // 单按钮：跳过 → 开始（onClick 闭包读当前 phase，见 skip/finish）
    this.button = makeButton(scene, 0, 0, '跳过', () => {
      if (this.phase === 'skip') this.skip()
      else this.finish()
    }, { minWidth: 160, fontSize: 22 }).setDepth(32).setScrollFactor(0)
    this.created.push(this.button)

    this.onThumbDrag = (_pointer, obj, _dragX, dragY) => {
      if (obj === this.thumb) this.scrollThumbTo(dragY)
    }
    scene.input.on('drag', this.onThumbDrag)
    this.onResize = () => this.layout()
    scene.scale.on('resize', this.onResize)
    this.layout()
    // 开始播放旁白；自然播完 → toStart（按钮变「开始」）
    this.narration = sfx.playNarration(intro.narration, () => this.toStart())
  }

  /** 整组元素按相机中心重定位（resize / 滚动共用） */
  private layout(): void {
    const cx = this.cam.width / 2
    const cy = this.cam.height / 2
    const viewY = cy - 130
    const trackX = cx + BODY_W / 2 + SCROLL_GAP
    this.overlay.setPosition(cx, cy).setSize(this.cam.width, this.cam.height)
    this.panel.setPosition(cx, cy)
    this.title.setPosition(cx, cy - 250)
    this.body.setPosition(cx, viewY - this.scrollY)
    this.objective.setPosition(cx, cy + 210)
    this.button.setPosition(cx, cy + 265)
    this.track?.setPosition(trackX, viewY + BODY_VIEW_H / 2)
    this.zone?.setPosition(cx, viewY + BODY_VIEW_H / 2)
    if (this.maxScroll > 0) {
      // 裁剪可视窗口 + 滑块位置（正文区固定顶 viewY，滚动 → 裁剪窗口下移、滑块下移）
      this.body.setCrop(0, this.scrollY, this.body.width, BODY_VIEW_H)
      this.thumb?.setPosition(trackX, viewY + this.thumbH / 2 + (this.scrollY / this.maxScroll) * (BODY_VIEW_H - this.thumbH))
    }
  }

  /** 点「跳过」：停旁白 → 进入「开始」态 */
  private skip(): void {
    this.narration?.stop()
    this.narration?.destroy()
    this.narration = null
    this.toStart()
  }

  /** 朗读结束 / 已跳过：按钮「跳过」→「开始」（守卫防 自然结束 与 跳过 双触发） */
  private toStart(): void {
    if (this.phase === 'start') return
    this.phase = 'start'
    this.button.setText('开始')
  }

  /** 点「开始」：销毁 modal → 放行场景输入（场景回调置 modalGestureLock） */
  private finish(): void {
    if (this.phase !== 'start') return
    this.destroy()
    this.onStart()
  }

  /** 滚轮滚动正文 */
  private scrollBy(dy: number): void {
    if (this.maxScroll <= 0) return
    this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, this.maxScroll)
    this.layout()
  }

  /** 拖动滑块 → 滚动正文（dragY 为滑块中心屏幕 y） */
  private scrollThumbTo(dragY: number): void {
    if (this.maxScroll <= 0 || !this.thumb) return
    const viewY = this.cam.height / 2 - 130
    const ratio = (dragY - (viewY + this.thumbH / 2)) / (BODY_VIEW_H - this.thumbH)
    this.scrollY = Phaser.Math.Clamp(ratio * this.maxScroll, 0, this.maxScroll)
    this.layout()
  }

  /** 按钮阶段（e2e 断言用）：'skip' 朗读中 / 'start' 已就绪 */
  getPhase(): 'skip' | 'start' {
    return this.phase
  }

  /** 按钮屏幕坐标（e2e 点击用；按钮 setScrollFactor(0) → x/y 即屏幕坐标） */
  getButtonPos(): { x: number; y: number } {
    return { x: this.button.x, y: this.button.y }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.narration?.stop()
    this.narration?.destroy()
    this.narration = null
    this.scene.input.off('drag', this.onThumbDrag)
    this.scene.scale.off('resize', this.onResize)
    this.body.setCrop()
    for (const o of this.created) o.destroy()
    this.created.length = 0
  }
}
