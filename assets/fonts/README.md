# 字体

| 文件 | 用途 | 来源 / 许可 |
|---|---|---|
| `MaShanZheng-display.woff2`（18KB） | 标题 / 单位大字 / 结果 / 日期等 **display 角色** | 马善政毛笔楷书，SIL OFL 1.1（可免费商用、可随游戏捆绑分发） |
| `LXGW-WenKai-seal.woff2`（1.4KB） | 印章单字「戰」（**繁体**） | 霞鹜文楷子集，SIL OFL 1.1 |

> 为什么印章用霞鹜文楷：马善政是 GB2312 **简体**字库（含「战」不含「戰」）；印章要繁体「戰」，故另从霞鹜文楷（简繁+日文，OFL）子集单字。

## 关于字体

- **原字体**：马善政毛笔楷书（Ma Shan Zheng），作者 ZhongQi 字库，收录于 Google Fonts（OFL 1.1，GB2312 6763 字全覆盖）。
  来源：https://github.com/googlefonts/mashanzheng ／ https://fonts.google.com/specimen/Ma+Shan+zheng
- **本文件是子集化产物**：用 `pyftsubset` 按游戏实际用字（标题/印章/单位大字/结果/日期/势力名）从全量 TTF 子集化并转 woff2（5.86MB → 18KB）。渲染层用 Phaser `this.load.font`（`format: 'woff2'`）在 LoadingScene 预载，Text 里 `fontFamily: 'MaShanZheng'` 引用。
- 正文 body 角色暂用系统 `sans-serif`（见 `UI-update-proposal.md`：M2 再引入 Noto Sans SC / 霞鹜文楷）。

## 重新子集化（新增显示用字时）

```bash
# 1) 下载全量 TTF（5.86MB，不入库）
curl -L -o /tmp/MaShanZheng-Regular.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/MaShanZheng-Regular.ttf

# 2) 把新增用字追加到字符清单文件，再子集化：
uvx --from fonttools --with brotli pyftsubset /tmp/MaShanZheng-Regular.ttf \
  --text-file=显示字符.txt --flavor=woff2 --output-file=assets/fonts/MaShanZheng-display.woff2
```

当前子集包含的字符：见同目录 `显示字符.txt`（pyftsubset `--text-file` 直接引用；新增显示用字时**追加到该文件**再重新子集化）。含主菜单/战斗用字 + 战役标题用字（千里走单骑东岭关选择役）。
