# UI 更新提议

> 状态：**提议 / 待评审** ｜ 提出：2026-08-13
> 来源：`frontend-design` UI 扫描（分支 `worktree-ui-improvement-scan`）
> 截图：`screenshots/ui-scan/01-main-menu.png`、`02-battle.png`、`03-adventure.png`（1920×1080，请人工目检）
> 落地后需按项目「PRD 同步」约定更新 `PRD.md` §15/§16。

---

## 1. 背景与现状

功能架构已干净（双相机 HUD、单向依赖、确定性 core），但**视觉上是"素 Phaser 原型"**：全 UI 用系统 `sans-serif`，无三国主题身份。按 frontend-design 视角的现状盘点：

| 维度 | 现状 | 评价 |
|---|---|---|
| 主体身份 | 深蓝底 + 石板蓝按钮 + 白字，无任何三国视觉元素 | ⚠️ 最大缺口 |
| 字体 | 100% 系统 `sans-serif`；仅字号分层（56/28/30/20/18/16/14） | ⚠️ 无字族对比 |
| 色彩 | `#0f1622` 底 / `#33415c` 按钮 / `#f5f2e8` 文 / `#5a7ab0` 强调；地图有势力色，UI 铬色不引用 | ⚠️ 有体系无身份 |
| 按钮 | 平涂文字块 + `useHandCursor`，无 hover/pressed/disabled/焦点态 | ⚠️ 缺状态反馈 |
| 面板/提示 | tooltip、城池/资源/战斗信息面板都是 `rgba(0,0,0,0.65)` 黑块文字 | ⚠️ 无面板语言 |
| 层级布局 | HUD 顶 / 地图中 / 工具栏底，双相机分离，e2e 已断言 | ✅ 良好 |
| 动效 | 菜单淡入、可达脉动、受击闪白、移动 tween；克制 | ✅ 基础到位 |
| 文案 | 主动语态、动作一致（开始游戏/结束回合/跳过/撤退） | ✅ 良好 |
| 无障碍底线 | 无键盘焦点指示、无 reduced-motion 考量 | ⚠️ 未覆盖 |

## 2. 设计目标（先定视觉身份，再改组件）

**核心方向：让 UI"像三国"，不靠堆装饰，靠器物语汇**（印章、书法、朱砂、鎏金、宣纸）。

- **色板（6 命名色）**
  - `night-ink #0e1420`（底色，比现 #0f1622 更沉）
  - `cinnabar #c2392b`（朱砂红 = 主强调 / 魏势力 / 印章色）
  - `jade #2f8f5b`（蜀绿，呼应现有势力色）
  - `gilt #d4a24c`（鎏金 = 高亮 / 宝箱 / 英雄，延续现 0xffd166）
  - `parchment #efe6d3`（宣纸白 = 正文，替换纯白冷感）
  - `slate-azure #6b7f9b`（辅助 / 静默信息，如 log）
- **字族（2+ 角色）**
  - Display：**楷书/书法**字体（开源 `Ma Shan Zheng`，Windows `STKaiti` 兜底）——标题、单位格大字（刀/弓/民）、胜利结果、日期。
  - Body：干净中文正文（`Noto Sans SC`，fallback `sans-serif`）——HUD/按钮/提示。
  - Utility：数量数值用紧凑/等宽（`tabular-nums`）。
  - 加载（已用 context7 核实 Phaser 4 Loader API）：`preload()` 里 `this.load.font({ key, url, format: 'truetype', descriptors: { style: 'normal', weight: '400' } })` → `create()` 里 Text `fontFamily: key`。新增 `assets/fonts/`，按 LoadingScene 一次性预载模式走。
- **签名元素**：**朱砂印章**——标题落一枚红印（篆体「三国」），胜利结算红印收场，势力单位/城池带迷你势力印。这是三国器物语汇里最有辨识度、最不易"AI 味"的一个。

## 3. 分优先级改进方案

### P0 视觉身份落地（建议先做）
| 项 | 具体改动 | 涉及文件 |
|---|---|---|
| 标题书法体 + 朱砂印 | 主菜单标题换 display 书法字体，右侧落红印（可先用一个圆形/方形 Graphics 印章再上字） | `MainMenuScene.ts`、`LoadingScene.ts`（预载字体）、`assets/fonts/` |
| 调色板替换 | 全局常量引入 token（night-ink/cinnabar/jade/gilt/parchment/slate-azure），替换各处硬编码色 | `src/ui/`、各 scene |

### P1 交互控件状态（低成本高感知）
| 项 | 具体改动 |
|---|---|
| 按钮三态 | hover/pressed/disabled 三态（改底色 + 描边 + 按压缩放），统一最小宽高 |
| 键盘可达 | 主菜单键盘导航（上/下 + Enter），按钮焦点指示（描边/高亮） |
| 场景转场 | 场景切换加 `cameras.main.fadeOut/fadeIn` 淡转场 |

### P2 面板与信息密度
| 项 | 具体改动 |
|---|---|
| 战斗信息面板 | 7 行纯文字黑块 → 结构化卡片（标题/兵种名 + 数值分组 + 势力色左边条） |
| 战斗 log | 裸文本 → 事件流面板（时间戳 + 势力色标签 + 单行动一行） |
| 工具提示 | 统一面板样式（1px 描边 + 内边距 + 小三角），替换千篇一律黑块 |

### P3 战斗可读性
| 项 | 具体改动 |
|---|---|
| 格上大字书法体 | 刀/弓/民/骑兵 用 display 字体 |

> 已剔除：**血条、飘血数字**——与 HOMM3 机制不符（兵力数量 + 受击闪白已足够表达损伤）。

### P4 文案 / 细节
| 项 | 具体改动 |
|---|---|
| 日期纪年味 | `第X周第X天` → 可加「初平三年 春」式纪年或「第X旬」 |

> 已剔除：**测试入口移出**——游戏仍在开发阶段，主菜单保留「战斗测试」入口，正式发布前再处理。

### 零美工落地方案（当前无美术资源）

> 核实：剩余改动全部可用 **开源字体（SIL OFL）+ Kenney CC0 资产 + Phaser 内置能力 + 纯代码** 实现，无需美术资源。

| 项 | 落地方案 |
|---|---|
| 标题/印章/大字字体 | 自托管 **马善政毛笔楷书**（OFL，GB2312 6763 字全覆盖），`this.load.font` 预载 |
| 正文 body 字体 | 自托管 **Noto Sans SC**（OFL）子集化；或 **霞鹜文楷**（OFL）整体楷体方案 |
| 面板/按钮纹理 | **Kenney UI Pack**（CC0，与在用 Board Game Icons 同源）+ Phaser 4 `add.nineslice`（API 已核实） |
| 朱砂印章 | Phaser `Graphics` 程序化（红底 + 楷体加粗白字）；真篆书待可商用字体 |
| 图标补充 | 继续用 Kenney Board Game Icons（1000+，现用 5 个） |
| 按钮态/键盘/转场 | Phaser 内置 + 纯代码 |

**注意——CJK 字体体积**：马善政 ~5MB、Noto Sans SC 更大。用 `pyftsubset`（fonttools，uv 安装）按游戏实际用字子集化 → UI 仅涉及几百汉字，可压到几百 KB。

## 4. 建议执行顺序

- **M1（约 30 分钟，观感提升最大）**：主菜单标题书法体 + 朱砂印；按钮补 hover/pressed 两态 + 统一尺寸；场景切换加 fade。
- **M2**：全局调色板 token 替换 + HUD 微调（收入分组、纪年日期）。
- **M3**：战斗信息面板卡片化、log 事件流、tooltip 统一。
- **M4**：格上大字书法体。
- **M5**：无障碍（键盘导航/焦点指示）。

## 5. 验收方式

- **逻辑/交互**：新增/改动均补 e2e 断言（按钮三态、场景转场、字体加载后 `getState` 可用）与 core 无关处不触碰 `pnpm test`。
- **观感**：每个里程碑存 `screenshots/ui-scan/` 新截图，**由用户人工目检**（agent 只校验 PNG 文件头，不分析像素）。
- 每完成一项，按「PRD 同步」约定更新 `PRD.md` §15/§16。

---

### 附：扫描过程的工具性观察（非产品 bug）

交互式 Playwright MCP 在会话里点 canvas 内按钮偶发不触发，但 **40 项 e2e 全过**、独立 Playwright 脚本在 1920×1080 下复现点击成功——菜单交互无回归。这是交互式 MCP 浏览器上下文与 canvas 输入坐标映射的驱动差异；会话内驱动游戏请走 dev bridge（`window.__game`）或 `pnpm test:e2e`。
