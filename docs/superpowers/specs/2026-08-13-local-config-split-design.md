# 设计：将平台/环境相关配置从项目 CLAUDE.md 抽到本地

日期：2026-08-13
状态：已批准（方案 A — `CLAUDE.local.md`）

## 背景与动机

项目 `CLAUDE.md`（已入库，所有贡献者都会读到）混入了 **Windows / deepseek 模型**等个人开发环境相关内容。这些内容对其他平台（macOS / Linux）或使用多模态模型的开发者不适用，会造成困惑。目标：

- 其他平台开发者 clone 后得到干净、平台中立的项目规范；
- 项目作者（Windows + deepseek）的既有开发流程不受影响。

## 方案：CLAUDE.local.md

- 新建 `CLAUDE.local.md`（git-ignored，`.gitignore` 已有 `*.local` 规则自动覆盖），存放个人环境相关说明；
- Claude Code 自动加载 `CLAUDE.local.md` 与 `CLAUDE.md` 两个文件，故个人流程行为不变。

## 内容划分

### 移入 CLAUDE.local.md（个人环境，平台相关）

- 「环境说明」整节：Windows 11；Bash 工具为 Git Bash；deepseek 模型行为（API 临时不可用 → 等待后重试；不支持多模态 → agent 无法看图）
- 「调试/回归工作流」中的环境原因表述（本项目模型为 deepseek、不支持多模态）

### 保留在项目 CLAUDE.md（平台中立规范）

- 架构、确定性、代码约定、常用命令、音频约定、PRD 同步
- 「调试/回归工作流」改为通用表述："界面验证以程序化断言为准，截图只作为给人看的产物；不要用像素颜色分析代替断言"

### README.md

- 第 90 行去掉 "本项目使用 deepseek 模型，不支持多模态" 句，改为平台中立表述，原则不变。

### 无需改动

- `.claude/settings.local.json`（已 git-ignored，全为 Windows 特有权限）
- `.gitignore`（`*.local` 与 `.claude/settings.local.json` 已有）
- `PRD.md`（基本平台中立）

## 验证

- `git status` 确认 `CLAUDE.local.md` 未被跟踪（git-ignored）
- 个人流程不变：新会话加载时 `CLAUDE.local.md` 与 `CLAUDE.md` 同时被读取
