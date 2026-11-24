# dsh-pomodoro-view

Pomodoro floating app for **DeepSeek Harness (DSH)**: a compact header pill opens a
draggable, chronograph-style timer window that floats above the whole workspace.

## 番茄钟浮窗应用（DSH 插件）

会话标题栏右侧的胶囊入口，点击弹出独立浮窗：衬线字计时表盘、60 根发丝刻度、机刻雕花纹理，
专注 25 分 → 短休 5 分 → 每 4 个专注一次长休 15 分。计时在浏览器内运行，切换会话/视图不中断；
状态、设置与窗口位置仅存本机 localStorage，不向模型或网络发送任何内容。

## Install 安装

**插件商店（推荐）**：DSH 侧栏「插件」→ 插件商店 → 发现，搜索 `dsh-pomodoro-view` 一键安装。

**命令行**：

```bash
dsh plugin --profile desktop add dsh-pomodoro-view
```

安装后打开任意会话，标题栏右侧出现「🍅 番茄钟」胶囊，点击即弹出浮窗。

## Features

- Pill mirrors the live countdown; an alert dot marks a phase that ended while closed
- Draggable dialog window (`role="dialog"`), remembered position, Escape closes (drawer first), Space toggles timer
- Settings drawer: focus / short / long durations, long-break interval, auto-start switches, end-of-phase chime
- Phase colors: vermilion (focus) → teal (short break) → amber (long break)
- Cycle dots + today's totals, midnight rollover, reload-safe countdown
- Host theme tokens throughout (light/dark), zh/en locale, accessible controls

## Uninstall 卸载

「插件」页 → 已安装 → 卸载，或：

```bash
dsh plugin --profile desktop remove dsh-pomodoro-view
```

MIT © swan-geese
