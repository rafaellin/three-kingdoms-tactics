import Phaser from 'phaser'
import { COLORS } from './theme'

/** 场景转场淡入/淡出时长（ms） */
export const SCENE_FADE_MS = 220

/** 墨底色的 RGB 分量（camera fade 参数用 0~255） */
const INK = [(COLORS.nightInk >> 16) & 0xff, (COLORS.nightInk >> 8) & 0xff, COLORS.nightInk & 0xff] as const

/**
 * 切换到目标场景：先淡出到墨色，完成后再 scene.start。
 * 目标场景 create() 里应调用 fadeIn(this) 从墨色淡入。
 */
export function fadeAndStart(scene: Phaser.Scene, target: string): void {
  scene.cameras.main.fadeOut(SCENE_FADE_MS, INK[0], INK[1], INK[2])
  scene.cameras.main.once('camerafadeoutcomplete', () => scene.scene.start(target))
}

/** 进入场景时从墨色淡入（在目标场景 create() 开头调用） */
export function fadeIn(scene: Phaser.Scene): void {
  scene.cameras.main.fadeIn(SCENE_FADE_MS, INK[0], INK[1], INK[2])
}
