# 资源图标

图标来源：**[Kenney — Board Game Icons](https://kenney.nl/assets/board-game-icons)**（CC0 公有领域，免署名）。

| 文件 | 用途 | 原名 |
|---|---|---|
| `icon-gold.png` | 金（HUD）/ 宝箱资源点 | `pouch` |
| `icon-wood.png` | 木（HUD）/ 伐木场 | `resource_wood` |
| `icon-stone.png` | 石（HUD）/ 采石场 | `structure_wall` |
| `icon-iron.png` | 铁（HUD）/ 冶铁厂 | `resource_iron` |
| `icon-town.png` | 城池 | `structure_house` |

均为 64×64 PNG，取 Kenney 的 **Default（64px）白剪影** 版本。渲染层用 Phaser `setTint` 按资源代表色上色（金=亮金/木=棕/石=灰/铁=银蓝；城池按归属色），无需彩色底图。若后续替换素材，保持同名覆盖即可（Vite 构建期自动纳入 `assets/`）。
