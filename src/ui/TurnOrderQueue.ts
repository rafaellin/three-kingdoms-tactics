import Phaser from 'phaser'
import { buildTurnOrderQueue } from '../core/battle/queue'
import type { BattleState } from '../core/battle/types'
import { UNIT_DEFS } from '../data/units'
import { BATTLE_SIDE_COLORS } from './theme'

/** 队列方块边长 / 间距 / 通栏条高度（px） */
const BLOCK = 46
const GAP = 8
const BAR_H = 88

/**
 * 战斗行动顺序条（渲染层，纯显示）。
 * 贴视口底部的通栏条，方块按三段队列（done/normal/wait）在左右两侧按钮区之间水平居中。
 * MVC：视图只读 buildTurnOrderQueue(state) + currentUnitId，无独立队列状态。
 * 不设 setInteractive → 不拦截地图拖拽/滚轮/点击（横条上交互原样传给地图）。
 */
export class TurnOrderQueue {
  private readonly bar: Phaser.GameObjects.Graphics
  private readonly squares: Phaser.GameObjects.Graphics
  private readonly labels = new Map<string, Phaser.GameObjects.Text>()
  private lastState: BattleState | null = null
  private visible = true
  private readonly leftW: number
  private readonly rightW: number

  constructor(private readonly scene: Phaser.Scene, options: { leftW: number; rightW: number }) {
    this.leftW = options.leftW
    this.rightW = options.rightW
    this.bar = scene.add.graphics().setDepth(10).setScrollFactor(0)
    this.squares = scene.add.graphics().setDepth(11).setScrollFactor(0)
    this.drawBar()
    scene.scale.on('resize', this.onResize)
  }

  /** 从 state 重绘整个队列（三段底色/大字/黄框高亮/灰态） */
  render(state: BattleState): void {
    this.lastState = state
    const entries = buildTurnOrderQueue(state)
    const cam = this.scene.cameras.main
    const totalW = entries.length * BLOCK + (entries.length - 1) * GAP
    const startX = this.leftW + (cam.width - this.leftW - this.rightW) / 2 - totalW / 2
    const y = cam.height - BAR_H / 2
    this.squares.clear()
    const seen = new Set<string>()
    entries.forEach((e, i) => {
      const x = startX + i * (BLOCK + GAP) + BLOCK / 2
      const x0 = x - BLOCK / 2
      const y0 = y - BLOCK / 2
      // 底色 = 兵种六边形格子同色（BATTLE_SIDE_COLORS 单源）；等待段与正常段同色（仅位置区分）
      this.squares.fillStyle(BATTLE_SIDE_COLORS[e.side], 1)
      this.squares.fillRect(x0, y0, BLOCK, BLOCK)
      // done 段 → 叠半透明黑灰「灰掉」；normal/wait → 保持原色
      if (e.segment === 'done') {
        this.squares.fillStyle(0x000000, 0.55)
        this.squares.fillRect(x0, y0, BLOCK, BLOCK)
      }
      // 当前行动单位 → 黄框高亮（与战场当前单位高亮同色 0xffcc33）；其余细黑描边（跨段有效）
      if (e.unitId === state.currentUnitId) {
        this.squares.lineStyle(3, 0xffcc33, 1)
        this.squares.strokeRect(x0, y0, BLOCK, BLOCK)
      } else {
        this.squares.lineStyle(1, 0x000000, 0.4)
        this.squares.strokeRect(x0, y0, BLOCK, BLOCK)
      }
      // 中央兵种大字（gridLabel；文字对象复用，单位消失时销毁）
      let label = this.labels.get(e.unitId)
      if (!label || !label.active) {
        label = this.scene.add
          .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(11)
          .setScrollFactor(0)
        this.labels.set(e.unitId, label)
      }
      label.setPosition(x, y)
      // 1×1 方块只显示一个汉字：gridLabel 在 1×2 地图格可放全名（如「骑兵」），方块放不下 → 取首字「骑」
      label.setText(UNIT_DEFS[e.defId].gridLabel.charAt(0))
      label.setColor(e.segment === 'done' ? '#7a808a' : '#ffffff')
      seen.add(e.unitId)
    })
    // 清理已不在队列中的文字对象（单位阵亡 / 队列收缩）
    for (const [id, t] of this.labels) {
      if (!seen.has(id)) {
        t.destroy()
        this.labels.delete(id)
      }
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.bar.setVisible(visible)
    this.squares.setVisible(visible)
    for (const t of this.labels.values()) t.setVisible(visible)
  }

  isVisible(): boolean {
    return this.visible
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize)
    this.bar.destroy()
    this.squares.destroy()
    for (const t of this.labels.values()) t.destroy()
    this.labels.clear()
  }

  private readonly onResize = (): void => {
    this.drawBar()
    if (this.lastState) this.render(this.lastState)
  }

  /** 全宽通栏条：半透明墨色底（与网格底色同系）；resize 时重绘宽度 */
  private drawBar(): void {
    const cam = this.scene.cameras.main
    this.bar.clear()
    this.bar.fillStyle(0x1a2333, 0.72)
    this.bar.fillRect(0, cam.height - BAR_H, cam.width, BAR_H)
  }
}
