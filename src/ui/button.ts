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
    minWidth = 0
  } = opts
  const hover = hoverBackground ?? lighten(background, 0.18)

  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: 'sans-serif',
    fontSize: `${fontSize}px`,
    color,
    backgroundColor: css(background),
    align: 'center'
  }
  if (minWidth > 0) style.fixedWidth = minWidth

  const btn = scene.add.text(x, y, label, style).setOrigin(0.5).setPadding(20, 10)
  btn.setInteractive({ useHandCursor: true })
  btn.on('pointerover', () => btn.setStyle({ backgroundColor: css(hover) }))
  btn.on('pointerout', () => btn.setStyle({ backgroundColor: css(background) }))
  btn.on('pointerdown', () => {
    btn.setScale(0.96)
    onClick()
  })
  btn.on('pointerup', () => btn.setScale(1))
  btn.on('pointerupoutside', () => btn.setScale(1))
  return btn
}
