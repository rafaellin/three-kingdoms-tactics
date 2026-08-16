import Phaser from 'phaser'
import { css, lighten } from './theme'

export interface ButtonOptions {
  /** 字号（px） */
  fontSize?: number
  /** 底色（默认石板蓝，与现有控件一致） */
  background?: number
  /** hover 底色（默认 = 底色变亮 18%，不换色相） */
  hoverBackground?: number
  /** 文字颜色 */
  color?: string
  /** 统一宽度（px）；>0 时按钮等宽、文字居中 */
  minWidth?: number
  /** 原点（默认居中 0.5,0.5；角落按钮用 1,0.5 右对齐） */
  origin?: { x: number; y: number }
  /** 内边距（px，默认 20×10；小按钮用 8×6 之类收窄） */
  padding?: { x: number; y: number }
}

/**
 * 可复用带状态按钮（渲染层）：hover 变亮（默认底色向白混合 18%）/ pressed 按压缩放。
 * 提供统一宽度（minWidth），保证同一排按钮尺寸一致。
 * 注意：点击回调在 pointerdown 触发（与既有场景按钮一致）；
 * 若需"动画期间不可点"的守卫，由调用方在回调里自判（见 MainMenuScene）。
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOptions = {}
): Phaser.GameObjects.Text {
  const {
    fontSize = 20,
    background = 0x33415c,
    hoverBackground,
    color = '#ffffff',
    minWidth = 0,
    origin,
    padding = { x: 20, y: 10 }
  } = opts
  const hover = hoverBackground ?? lighten(background, 0.18)
  const originX = origin?.x ?? 0.5
  const originY = origin?.y ?? 0.5

  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: 'sans-serif',
    fontSize: `${fontSize}px`,
    color,
    backgroundColor: css(background),
    align: 'center'
  }
  if (minWidth > 0) style.fixedWidth = minWidth

  const btn = scene.add.text(x, y, label, style).setOrigin(originX, originY).setPadding(padding.x, padding.y)
  btn.setInteractive({ useHandCursor: true })
  btn.on('pointerover', () => btn.setStyle({ backgroundColor: css(hover) }))
  btn.on('pointerout', () => btn.setStyle({ backgroundColor: css(background) }))
  btn.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (p.button !== 0) return // 仅左键触发（右键/中键不触发按钮）
    btn.setScale(0.96)
    onClick()
  })
  btn.on('pointerup', () => btn.setScale(1))
  btn.on('pointerupoutside', () => btn.setScale(1))
  return btn
}
