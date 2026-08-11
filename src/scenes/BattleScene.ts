import Phaser from 'phaser'

/** 战斗场景（渲染层）——完整实现在 Task 10 */
export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'Battle'
  constructor() {
    super(BattleScene.KEY)
  }
}
