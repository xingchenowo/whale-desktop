# 小鲸鱼余额挂件 · 桌面版（whale-desktop）

> **原作者 / Original author：MeteorNOX**  
> **二改 / secondary modification：xingchenowo**
> **上游项目 / Upstream：** [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)  
> **许可证 / License：** MIT License，Copyright (c) 2026 MeteorNOX

把 DSH 网页里的小鲸鱼余额挂件**脱离 DSH 独立出来**，作为 Windows 桌面常驻挂件运行。

本项目基于harness&codex，感谢两位老师的无私奉献（x）

它不再需要 DSH，也不再依赖浏览器：自己开一个透明的置顶窗口，自己拉取 DeepSeek 余额，自己记账。
同时补上了原插件缺的两件事——**台词可配置（带权重）** 和 **完整皮肤包**。

---

## 与原 DSH 插件的差异

| 能力 | DSH 插件 | 桌面版 |
| --- | --- | --- |
| 运行环境 | DSH Web 界面内注入 | 独立 Electron 进程 + 托盘 |
| 余额 | ✅ | ✅（同一接口、同样的 25s 缓存与重试） |
| 今日已用 | 记账 / 令牌两种模式 | ✅ 两种模式都保留 |
| **每轮对话消耗** | ✅ 监听 DSH 会话事件 | ❌ **已移除**，脱离 DSH 后拿不到会话事件 |
| 拖拽 / 吸附 | ✅ | ✅（四边吸附，记忆位置） |
| 随机台词 | 权重写死在代码里 | ✅ **`lines.jsonc` 可自定义台词与权重** |
| 换肤 | 换图需改代码几何常量 | ✅ **皮肤包**：贴图 / 音效 / gif / 台词 / 几何参数 |
| 鼠标穿透 | 不适用 | ✅ 非挂件区域点击穿透到下层窗口 |

> **关于「每轮对话消耗统计」**：这一项依赖 DSH 内部的 `session/event` 事件流，独立运行后无法获取。
> 如果你需要它，继续用 DSH 插件版；桌面版专注余额与挂件体验。

---

## 快速开始

### 直接使用 Windows 版

```text
WhaleDesktop-Portable-0.3.2-x64.exe   # 单文件便携版，双击直接运行
WhaleDesktop-Setup-0.3.2-x64.exe      # NSIS 安装程序，创建快捷方式
```

安装后的应用名和快捷方式名称为 **WhaleDesktop(v0.3.2)**。两种产物都已经包含 Electron 运行时，目标电脑不需要安装 Node.js、npm 或 DSH。
用户数据仍写在 `%APPDATA%\dsh-whale-desktop\`，升级或卸载程序不会自动删除配置和皮肤。

### 从源码运行

```powershell
cd D:\harness\whale-desktop
npm install
npm start
```

启动后：右下角出现小鲸鱼 → 托盘出现鲸鱼图标。
左键托盘图标可显示/隐藏，右键打开菜单（皮肤 / 刷新 / 双开桌宠 / 水平翻转 / 打开配置 / 开机自启 / 退出）。

**想让挂件在关掉终端后继续运行**，用附带脚本以后台方式启动：

```powershell
.\start-pet.cmd            # 或 npm run start:detached
.\start-pet.cmd --debug    # 同时把日志打到控制台
```

> `npm install` 若卡在 Electron 二进制下载（它走 GitHub），换镜像后重装：
> ```powershell
> $env:ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
> npm install
> ```

### 构建 Windows 便携 exe 和安装程序

```powershell
# 单文件便携版 exe
npm run build:portable-exe

# NSIS 安装程序
npm run build:installer

# 一次构建两个
npm run build:windows
```

构建结果：

```text
dist-installer\portable\WhaleDesktop-Portable-0.3.2-x64.exe
dist-installer\nsis\WhaleDesktop-Setup-0.3.2-x64.exe
```

安装程序是**当前用户安装**，不需要管理员权限，可以选择安装目录，并创建桌面和开始菜单快捷方式。
卸载时默认**不会删除** `%APPDATA%\dsh-whale-desktop\`，你的配置、账本和皮肤会保留。

### 开机自启

托盘菜单的「开机自启」不调用 Electron 的 `setLoginItemSettings`，而是由程序使用 Windows `reg.exe` 写入当前用户启动项：

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
值名：H1kaRU.WhaleDesktop
值内容："<已编译的 WhaleDesktop.exe>" --autostart
```

- 便携版写入 `PORTABLE_EXECUTABLE_FILE` 指向的实际便携 exe；如果之后移动了便携版，需要先取消勾选，再重新勾选。
- 安装版写入安装目录释放出的 `WhaleDesktop(v0.3.2).exe`。如果更换了安装目录，重新勾选一次即可更新注册表路径。
- 开发模式 `npm start` 不会把 Electron 开发程序写入启动项；请使用已编译的便携版或安装版。
- 旧版 `MeteorNOX.WhaleDesktop` 启动项会在新版启动时自动迁移到 `H1kaRU.WhaleDesktop`，并删除旧值。
- 该启动项只对当前 Windows 用户生效，不需要管理员权限。

> 当前构建没有代码签名证书，Windows SmartScreen 可能显示“未知发布者”。选择“仍要运行”即可；正式发布建议购买代码签名证书后重新打包。

旧的文件夹便携版仍可通过下面的命令生成：

```powershell
npm run build:portable
```

结果在 `dist\whale-desktop-win\`。

### 没有余额显示？

程序按以下顺序找 DeepSeek API Key，命中即用：

1. `config.jsonc` 里的 `apiKey`
2. 环境变量 `DEEPSEEK_API_KEY`
3. **DSH 凭据**：`%USERPROFILE%\.dsh\.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`

第 3 条是为了让你不用重复粘贴——如果你已经给 DSH 配过 key，桌面版开箱即可读到。
想单独配置，就在菜单里点「配置文件」，编辑 `config.jsonc` 的 `apiKey` 字段。

---

## 配置文件在哪

全部用户数据都在 **`%APPDATA%\dsh-whale-desktop\`**：

```
%APPDATA%\dsh-whale-desktop\
├── config.jsonc        主配置
├── lines.jsonc         随机台词 + 权重
├── peaks.jsonc         具名峰谷文案列表
├── skins\
│   └── default\        默认皮肤包
│       ├── skin.jsonc  皮肤定义（几何参数、音效表）
│       ├── whale.png   立绘（透明背景 cut-out）
│       ├── rua.gif     动图（可选）
│       └── sounds\     音效 mp3
├── .usage.json         鲸鱼记账账本（自动维护）
└── whale.log           运行日志（排查问题用）
```

菜单里的「配置文件 / 台词文件 / 峰谷文案 / 皮肤文件夹 / 当前皮肤」按钮会直接帮你打开对应位置。
改完文件点菜单「重载配置」即可生效，**不用重启**。

---

## 台词配置（`lines.jsonc`）

支持 `//` 注释和尾逗号。整体结构是**加权分组**：

```jsonc
{
  "groups": [
    // 权重 45：内置动态内容（当前时间段 + 今日已用）
    { "w": 45, "builtin": "period" },

    // 权重 7：从 variants 里等概率抽一条
    { "w": 7, "variants": ["好模型... ↓", "好女孩...↓"], "style": "B" },

    // 权重 7：多行台词，wrap 让长句自动换行
    {
      "w": 7, "style": "A", "wrap": true,
      "variants": [
        "不知道用户有什么用，先赶走吧~",
        "我...我...我也要挣钱吗？"
      ]
    },

    // 权重 10：显示皮肤包里的 rua.gif 动图
    { "w": 10, "gif": true },

    // 权重 4：组内再按变体权重抽（3 : 1）
    {
      "w": 4,
      "variants": [
        { "w": 3, "lines": [{ "t": "哦鲸鲸...", "s": "B" }] },
        { "w": 1, "lines": [{ "t": "稀客", "s": "A" }] }
      ]
    }
  ]
}
```

如果你只想改几句台词，可以不用 `groups`，直接写扁平的 `lines` 数组。
这里的 `weight` 就是权重，支持整数和小数；`weight: 0` 表示禁用：

```jsonc
{
  "lines": [
    { "text": "余额还有 {balance}", "weight": 9, "style": "B" },
    { "text": "今天也要好好干活", "weight": 2, "style": "A" },
    { "text": "这句暂时不要", "weight": 0, "style": "C" }
  ]
}
```

`weight` 和 `w` 两种写法都支持；扁平格式里每句台词自己就是变体，
所以权重直接写在每句上。复杂分组、内置时段、gif、多行样式仍使用上面的 `groups` 格式。

### 权重怎么算

权重是**相对值**，不是百分比。上面这组 45/7/7/10/4 加起来是 73：

- `builtin` 组被抽中的概率 = 45 / 73 ≈ 61.6%
- `gif` 组 = 10 / 73 ≈ 13.7%

组内 `variants` 默认**等概率**；写成 `{ "w": 数字, "lines": [...] }` 就按变体权重抽。
把某组 `w` 设为 `0` 就等于临时关掉它。

### 字段速查

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `w` / `weight` | 组 / 变体 / 扁平台词 | 权重，相对值，`0` = 禁用 |
| `enabled` | 组 | 设为 `false` 可临时禁用整组 |
| `builtin` | 组 | `"period"` = 内置的「当前时间段 + 今日已用」 |
| `gif` | 组 | `true` = 显示皮肤包里的 `rua.gif` |
| `variants` | 组 | 候选台词数组，元素可以是字符串或 `{w, lines}` |
| `style` / `wrap` / `color` | 组 | 该组所有行的默认样式 |
| `lines` | 变体 | 行数组，最多 3 行 |

### 行格式

```jsonc
{ "t": "文本", "s": "A", "c": "#e0433f", "w": true }
```

| 键 | 含义 |
| --- | --- |
| `t` | 文本内容 |
| `s` | 样式：`A` 小字标题 / `B` 大字金额 / `C` 灰色提示（`P` 中号彩色，用于时段） |
| `c` | 颜色，如 `#e0433f`；留空用默认色 |
| `w` | `true` = 长文本自动换行 |

三行位置是固定的：`lines[0]` 第一行、`lines[1]` 中间大字、`lines[2]` 底部灰色小字。
只想显示一行就把它放在中间：`[null, {"t": "文本", "s": "B"}, null]`。

### 占位符

文本里可用，会在显示时替换成实时值：

| 占位符 | 含义 |
| --- | --- |
| `{today}` | 今日已用 |
| `{balance}` | 当前余额 |
| `{currency}` | 币种 |
| `{period}` | 当前时段（受 `peakPreset` 影响） |

例：`{ "t": "还剩 {balance} 呢", "s": "A" }`

---

## 皮肤包

一个皮肤 = `skins\<名字>\` 一个目录。**复制 `default` 目录改名**就是最快的做法：

```powershell
cd $env:APPDATA\dsh-whale-desktop\skins
Copy-Item -Recurse default my-whale
```

然后在 `my-whale\skin.jsonc` 里改，再把 `my-whale\whale.png` 换成你的立绘。
菜单 →「皮肤」里会立刻出现新皮肤（切换即时生效，无需重启）。

### `skin.jsonc`

```jsonc
{
  "name": "my-whale",
  "displayName": "我的鲸鱼",
  "description": "说明文字",
  "author": "你的名字",

  "image": "whale.png",     // 立绘，省略则依次找 whale.png / DSniang1.png / DSniang02.png
  "gif": "rua.gif",         // 可选，供 { "gif": true } 台词组使用

  // 音效表：key 就是菜单里音效下拉的选项
  "sounds": {
    "duck": { "label": "小黄鸭", "press": "sounds/Ya1.mp3", "release": "sounds/Ya2.mp3" },
    "fx1":  { "label": "音效1", "press": "sounds/D1.mp3",  "release": "sounds/D2.mp3" }
  },

  // 几何参数：全部是「占基准单位 U 的比例」，U = 窗口宽度 / bubble.width
  "geometry": {
    "img":    { "width": 0.5968, "height": 0.5968, "right": 0, "bottom": 0 },
    "bubble": { "width": 1, "aspect": 1.4657, "left": -0.07, "top": -0.15 },
    "text":   { "leftPct": 0.4425, "topPct": 0.35, "anchor": "center" },
    "font":   { "label": 0.0643, "amount": 0.1248, "period": 0.1014, "hint": 0.0546 },
    "wrapMax": 0.5458,
    "gif":    { "leftPct": 0.4425, "topPct": 0.38, "maxW": 0.5458, "maxH": 0.3899 },
    "menuBtn": { "topRatio": 0.4055, "right": 4, "size": 26 },
    "windowPadding": 16
  }
}
```

### 几何参数怎么理解

原插件把 `59.45%` 这类数字**写死在代码里**，所以换一张透明边距不同的图，气泡里文字就会错位——
这正是要把它做成皮肤参数的原因。

- `img.width` / `img.height`：立绘占多大。**只改宽高比**就能适配不同比例的图。
- `img.right` / `img.bottom`：立绘离右下角多远。想让它更靠下就把 `bottom` 设成负数。
- `bubble.*`：气泡框。`width` 是基准（单位 U 由它定义），`aspect` = 宽/高；
  `left` / `top` 控制气泡相对于立绘的位置，负数表示向上或向左。
- `text.leftPct` / `text.topPct`：**三行文字的中心点**在气泡框内的百分比位置（0.4425 = 44.25%）。
- `font.*`：各样式字号，占 U 的比例。图变小了就把这几个一起调小。
- `menuBtn.topRatio`：汉堡按钮距内容顶部的比例。

**换图后没对齐怎么办**：先调 `text.leftPct` / `text.topPct` 让文字回到气泡中央，
再调 `img.width` / `img.height` / `img.right` / `img.bottom` 把立绘摆正。改完点菜单「重载配置」。

> **想直接看几何参数怎么起作用**，跑一下 `npm run make-demo-skin`，它会在皮肤目录里生成一个
> `demo-small`：同一张立绘、但图片框缩小右移、文字下移。在菜单「皮肤」里切换过去，
> 你会看到窗口自己跟着变小——这就是「按皮肤几何自适应窗口尺寸」。

> **默认皮肤不写 geometry**。它继承程序内置的参考几何（`src/main/skins.cjs` 的 `BASE_GEOMETRY`），
> 所以升级程序时默认皮肤会跟着更新，不会像原插件那样把 `59.45%` 这类常量固化在用户文件里。
> 你在自己的皮肤里写 `geometry` 覆盖任意字段，该皮肤就不再跟随内置默认值。

> 立绘必须是**透明背景的 cut-out**。不透明背景会让鼠标穿透的命中判定（按像素 alpha 判断）失效，
> 整个矩形窗口都会挡住下层点击。

---

## 主配置（`config.jsonc`）


| 键 | 默认 | 说明 |
| --- | --- | --- |
| `skin` | `"default"` | 皮肤目录名 |
| `scale` | `1.4` | 整体大小倍率（0.6–2.5） |
| `anchor` | 右下 | 启动停靠位置 `{h, v, hDist, vDist}` |
| `alwaysOnTop` | `true` | 窗口置顶 |
| `linesFile` | `"lines.jsonc"` | 台词文件路径，可指向别处 |
| `randomLines` | `true` | 点击气泡切随机台词 |
| `bubbleOn` | `true` | 是否允许显示气泡 |
| `bubbleMs` | `5000` | 气泡自动收起毫秒数 |
| `displayMode` | `"balance"` | 默认显示：`balance` 余额 / `time` 时间 / `keyboard` 键盘按键 |
| `keyboardClickMode` | `"balance"` | 键盘模式下点击桌宠显示：`balance` 余额 / `time` 时间 |
| `usageMode` | `"ledger"` | `ledger` 记账 / `token` 平台令牌实时 |
| `apiKey` | `""` | 留空则读环境变量或 DSH 凭据 |
| `platformToken` | `""` | 仅 `token` 模式需要 |

| `refreshMs` | `60000` | 余额刷新间隔（最小 10000） |
| `peakPreset` | `"default"` | 独立 `peaks.jsonc` 中选中的峰谷文案项 id |
| `sound` / `volume` / `soundSet` | `true` / `0.9` / `"duck"` | 音效开关、音量和皮肤自带音效组；双开时每个桌宠独立保存 |
| `draggable` | `true` | 允许拖动 |
| `passthrough` | `true` | 非挂件区域点击穿透 |
| `showMenuButton` | `true` | 悬停显示汉堡按钮 |

### 显示模式和自定义峰谷文案

`displayMode` 控制桌宠默认显示什么：

```jsonc
{
  // DeepSeek 余额
  "displayMode": "balance",

  // 时间
  // "displayMode": "time",

  // 键盘按键
  // "displayMode": "keyboard"
}
```

`time` 模式会显示当前时间，并在气泡打开时每秒刷新。

`keyboard` 模式会启动一个**只监听、不消费按键**的全局键盘钩子。按下键盘后，气泡会自动弹出并显示按键名称；同时按住多个键时按顺序显示 `第一个 + 第二个 + 第三个`，最多显示三个；按键气泡显示 1.5 秒后自动收起。游戏和其他程序仍会正常收到按键。该模式不记录按键历史，不写入日志，也不会上传任何按键内容。

键盘模式下点击桌宠气泡时，会显示 `keyboardClickMode` 指定的内容：

```jsonc
{
  "displayMode": "keyboard",
  "keyboardClickMode": "balance" // 或 "time"
}
```

按住 Shift 使用数字键时，会显示键盘符号而不是 `Shift + 数字`，例如：

```text
Shift+1 -> !
Shift+2 -> @
Shift+3 -> #
Shift+4 -> $
Shift+5 -> %
Shift+6 -> ^
Shift+7 -> &
Shift+8 -> *
Shift+9 -> (
Shift+0 -> )
```

自定义峰谷文案使用独立文件 `%APPDATA%\dsh-whale-desktop\peaks.jsonc`。
每个 `presets` 项都会在菜单的「峰谷文案」下拉框里显示为一项，`name` 是菜单名：

```jsonc
{
  "presets": [
    { "id": "default", "name": "默认", "peak": "高峰时段", "offPeak": "空闲时段" },
    { "id": "work", "name": "工作时段", "peak": "忙时", "offPeak": "闲时" },
    { "name": "我的第三套", "peak": "峰", "offPeak": "谷" }
  ]
}
```

`id` 可以省略，程序会自动生成。文件里设置几项，菜单里就显示几项；当前选中的 id 保存在 `config.jsonc` 的 `peakPreset` 中。

### 用量模式

**① 小鲸鱼记账（默认，免令牌）**：每次观测到余额下降就把差值记进当天用量，跨天归零、保留 30 天。
币种变化时只重置基准不记差值（避免多币种切换记出假账）。
账本：`%APPDATA%\dsh-whale-desktop\.usage.json`。缺点：挂件没运行时发生的消耗会漏记。

**② 实时·令牌**：需要 `DEEPSEEK_PLATFORM_TOKEN`（DeepSeek **平台网页**的会话令牌，不是 `sk-` 开头的 API key）。
获取：登录 platform.deepseek.com → F12 → Network → 找到 `usage/by_api_key/amount` 请求 →
复制 Request Headers 里 `Authorization` 的值 → 填到 `config.jsonc` 的 `platformToken`。
接口只返回 token 分桶，挂件按内置峰谷定价表换算成金额；定价表在 `src/main/balance.cjs` 顶部 `PRICING`。

---

## 操作说明

| 操作 | 效果 |
| --- | --- |
| 左键点鲸鱼 | 打开当前显示模式的气泡 / 关闭 |
| 点气泡 | 切到随机台词（再点关闭） |
| 按住鲸鱼拖动 | 移动；松手吸附到最近的边并记忆位置 |
| 悬停鲸鱼右上 | 出现汉堡菜单按钮 |
| 右键鲸鱼 | 打开菜单 |
| 鼠标悬停桌宠 | 左上角显示锁图标；鼠标离开后保留约 0.7 秒再隐藏，方便移动到图标上 |
| 点击左上角锁图标 | 锁定 / 解除锁定；锁定时锁图标常驻，桌宠其余区域全部鼠标穿透 |
| 键盘模式按下按键 | 自动弹出气泡并显示按键，按键不会被拦截 |
| 托盘左键 | 显示/隐藏 |
| 托盘右键 | 皮肤 / 刷新 / 双开桌宠 / 水平翻转 / 打开配置 / 开机自启 / 退出 |
| 托盘菜单 → 打开配置 | 第二级：打开配置文件夹 / 打开台词文件 / 打开峰谷文件 |
| 托盘菜单 → 开机自启 | 直接写当前用户注册表，指向已编译的 `WhaleDesktop(v0.3.2).exe` |
| 菜单 → 双开桌宠 | 启动或关闭第二个独立桌宠窗口 |
| 菜单 → 水平翻转 | 只翻转当前桌宠；双开时两个桌宠各自独立控制 |
| 菜单 → 音效 | 原音效控制：开关 / 皮肤音效组 / 音量；双开时每个桌宠独立保存 |

---

## 文件结构

```
whale-desktop/
├── LICENSE
├── package.json
├── start-pet.cmd           # 后台方式启动（关掉终端也不退出）
├── assets/                 # 自带素材（首次运行会复制到皮肤目录）
│   ├── DSniang1.png        # 立绘
│   ├── rua.gif             # 动图
│   ├── Ya1/Ya2.mp3         # 小黄鸭音效
│   └── D1/D2.mp3           # 音效1
├── tools/
│   ├── test-lines.cjs             # 台词加权逻辑测试（npm test）
│   ├── make-demo-skin.cjs         # 生成演示皮肤（不同几何）
│   ├── build-portable.cjs         # 构建 Windows 便携版（npm run build:portable）
│   ├── screenshot.cjs             # 全屏截图
│   ├── make-tray-icon.cjs         # 生成托盘图标
│   └── check-encoding.cjs         # 检查文件编码/BOM
├── dist/                    # 便携版构建结果（执行构建后生成）
└── src/
    ├── main/
    │   ├── main.cjs        # 窗口 / 托盘 / 拖拽 / IPC
    │   ├── autostart.cjs  # Windows 注册表开机自启（不依赖 Electron API）
    │   ├── preload.cjs     # 渲染端唯一桥梁（无 Node 暴露）
    │   ├── config.cjs      # 主配置默认值与加载
    │   ├── lines.cjs       # 台词加权抽取
    │   ├── peaks.cjs       # 独立峰谷文案列表
    │   ├── skins.cjs       # 皮肤包扫描与几何
    │   ├── balance.cjs     # 余额 / 平台用量 / 峰谷定价
    │   ├── ledger.cjs      # 小鲸鱼记账账本
    │   ├── credentials.cjs # key 解析（config → env → DSH 凭据）
    │   ├── keyboard.cjs    # 全局非拦截键盘监听（仅 keyboard 模式启动）
    │   ├── paths.cjs       # 数据目录与日志
    │   └── lib/jsonc.cjs   # JSONC 解析 / 原子写
    └── renderer/
        ├── index.html
        ├── pet.css         # 视觉样式（尺寸由 JS 按几何设置）
        └── pet.js          # 挂件逻辑：气泡 / 拖拽 / 菜单 / 台词
```

### 无头验证与调试

不用盯着屏幕也能验证渲染是否正常：

```powershell
# 启动、打开气泡、截图窗口、打印状态、退出
npx electron . --verify-shot out.png --click

# 先切到指定皮肤再截图
npx electron . --verify-shot out.png --click --skin demo-small

# 打开菜单截图
npx electron . --verify-shot out.png --menu

# 连续走 10 次随机台词抽取并打印结果
npx electron . --verify-shot out.png --click --random 10

# 台词加权逻辑单测（9:1 分布、0 权重禁用、变体权重）
npm test
```

运行期的渲染错误、皮肤/台词解析问题都会写进 `whale.log`，
渲染端 console 也会被转发进去（否则打包成托盘应用后这类错误完全不可见）。

### 架构要点

- **窗口自适尺寸**：渲染端按皮肤几何算出内容尺寸，通过 `whale:resize` 让主进程调整窗口，
  并按锚定边保持贴合，所以缩放时是「原地长大」而不是漂移。
- **鼠标穿透**：渲染端用 canvas 读立绘 alpha，判断指针是否真的在鲸鱼身上，
  不在就 `setIgnoreMouseEvents(true, {forward:true})`——所以透明区域不会挡住下层窗口。
- **锁定模式**：锁图标始终保留命中区域；锁定后鲸鱼本体、气泡和菜单全部穿透，只有锁图标可点击解除。
- **键盘监听**：仅在 `displayMode="keyboard"` 时启动 `uiohook-napi`。它是观察型系统钩子，
  不消费按键、不阻止游戏输入，也不持久化按键历史。
- **拖拽**：主进程轮询 `screen.getCursorScreenPoint()` 跟随光标，
  而不是用 `-webkit-app-region: drag`（那会吞掉悬停事件，菜单按钮就再也高亮不了）。
- **资源访问**：渲染端通过自定义 `whale-asset://` 协议读取素材，且只允许
  `%APPDATA%\dsh-whale-desktop` 与包内 `assets` 两个目录，配合 CSP 无网络访问。

---

## 排查

先看 `%APPDATA%\dsh-whale-desktop\whale.log`。

| 现象 | 处理 |
| --- | --- |
| 鲸鱼不出现 | 看托盘是否在；`npm start` 的终端输出贴出来 |
| 余额显示 `--` | 菜单「立即刷新」；确认 key 已配（见「没有余额显示？」） |
| 今日已用 `--` | 记账模式需要先观测到一次余额，60 秒内自动完成 |
| 台词改了没变 | 菜单点「重载配置」；确认 `lines.jsonc` 没有语法错误（日志里会写） |
| 台词还是旧的 | `lines.jsonc` 语法错误时会回退到内置默认台词，日志有 `lines error:` |
| 换皮肤后文字错位 | 调该皮肤的 `geometry.text` 与 `geometry.img`，见上文 |
| 穿透把鲸鱼也穿透了 | 立绘不是透明背景 cut-out，换个透明底图 |
| 想恢复默认 | 删掉 `%APPDATA%\dsh-whale-desktop\` 重新 `npm start` |

### 调试

```powershell
$env:WHALE_DEBUG=1; npm start   # 日志同时打到控制台
```

---

## 已知限制

- **每轮对话消耗统计已移除**（依赖 DSH 内部事件，独立版无法获取）。
- 仅在 **Windows** 上验证过。透明窗口与鼠标穿透在 macOS / Linux 上可能需要额外适配。
- 默认提供的是**免安装便携版**，不是 NSIS 安装包；解压文件夹即可运行。
- 立绘之外的素材（音效 / gif）缺失时会静默降级，不会报错。
- 托盘图标由 `tools/make-tray-icon.cjs` 从立绘生成；想换更锐利的图标，
  直接替换 `assets\tray.png`（建议 32×32 PNG），程序会优先使用它。
- 菜单里改设置时，程序只把**你改过的键**写回 `config.jsonc`；
  但重写会保留注释头、无法保留你在字段之间手写的行内注释。

## 作者、来源与许可证

- **原始项目作者：** MeteorNOX
- **原始项目：** [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)
- **原始仓库：** <https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget>
- **问题反馈：** <https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/issues>
- **原始包名：** `dsh-whale-widget`
- **原始项目描述：** DSH Web 界面右下角的 DeepSeek 余额小鲸鱼挂件（含今日已用、峰谷定价、随机台词、音效与每轮消耗统计）
- **原始许可证：** MIT License
- **原始版权：** Copyright (c) 2026 MeteorNOX

本桌面版是在原 DSH 插件及素材的基础上，为 Windows 独立运行、随机台词配置和皮肤包能力而做的衍生改造，保留原作者署名、上游链接和 MIT 许可证。再次分发本项目的代码或素材时，请同时保留 [LICENSE](./LICENSE) 中的版权与许可声明。

## 致谢

感谢 MeteorNOX 创作并开源 DeepSeek-Balance-Whale-Widget，以及上游项目提供的小鲸鱼素材、余额挂件交互和 DSH 插件实现。
































