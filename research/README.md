# research/ —— 开发过程中的探测脚本（不是程序的一部分）

这个目录里的东西**运行时完全用不到**，留着是因为整个方案是靠它们一步步试出来的，
以后想改客户端适配、或者换网易云版本时，这些脚本能直接拿来复现。

## 这里的脚本在试探什么

| 脚本 | 试探的问题 | 结论 |
| --- | --- | --- |
| `probe.mjs` ~ `probe7.mjs` | 客户端是不是 CEF？能不能开调试端口？页面长什么样？ | 能。`--remote-debugging-port=9229` 直接可用，**不需要 BetterNCM 之类的注入** |
| `probe2` ~ `probe5` | 进度条在哪？怎么读时长？ | 进度条是 `.slider-default`，宽度和位置线性对应；总时长要从 React fiber 里捞 `resourceDuration` |
| `probe6` ~ `probe9` | 播放条 DOM、有没有可编程接口 | 找到全局 `dbg.Command` / `legacyNativeCmder` / `api`，但**都是空的或不相关的** |
| `probe12` `probe13` | 把客户端所有 JS 落盘看能不能静态分析出播放入口 | 落了 50 个 chunk、1000 万字符。`player.*` 命令**全是迷你播放器窗口的**，跟主播放器无关 |
| `probe14` ~ `probe17` | 搜索 → 播放这条路 | **打通**：搜索框 `Input.insertText` + Enter → 点 `#cmdTab1`（单曲）→ 在 fiber 里按 `data.id` 找行 → 派发合成 `dblclick` |
| `probe18` ~ `probe23` | 能不能不靠调试端口，用 `--webcmd` / `orpheus://` 协议遥控已开着的客户端 | **全都失败**。这条路彻底判死了 |
| `probe19` `probe20` | 能不能直接操作 redux store | **能**：从 `#root` 的 `__reactContainer$…` fiber 里挖出 store，`dispatch` 暂停/继续/跳转都生效 |
| `probe24` ~ `probe28` | 能不能用 `playing/setPlaying` 注入一首歌直接播 | **不能**。UI 会显示"正在播放"，但原生播放器根本没有音频流，位置永远不动 |
| `probe29` ~ `probe32` | 那 seek 到底怎么才算数？ | **暂停 → `playing/setPlayingPosition` → 继续**，误差 0.05 秒。而且必须让 app 自己（双击）去加载歌，注入的没用 |
| `probe33` ~ `probe37` | 为什么有的歌搜不到 / 播不了 | 关键词要带**歌手 + 专辑**才能把原版顶到第一位；`/api/song/enhance/privilege` 的 `st < 0` 表示这个账号放不了（版权/地区） |

## 其它文件

- `cdp.mjs` —— 最早那版 CDP 客户端（`connect / evaluate / clickAt / seekTo`）。后来被 `lib/ncm.mjs` 取代了，只被这里的 probe 引用。
- `daemon.mjs` —— 第一版命令行热键守护（`config.json` + `node daemon.mjs`）。
  你当时说"我要的是个能配置的应用程序，不是这种东西"，于是才有了现在的 WinForms 界面。留作纪念。
- `play.mjs` / `state.mjs` / `verify.mjs` / `health.mjs` —— 命令行时期的小工具。
- `legacy/` —— 更早的 PowerShell 尝试：`RegisterHotKey` 原型（`hotkey.ps1`）、SMTC 探测（`smtc.ps1`）、
  启动客户端（`launch*.ps1`）、往已运行实例发命令（`senduri.ps1` / `webcmd.ps1`）等等。

## 跑这些脚本

需要：Windows 侧的 Node，以及一个带调试端口启动的网易云客户端。
（脚本当初都是通过 UNC 路径用 Windows 的 `node.exe` 跑的，直接在本机跑也行。）

```powershell
# 先让网易云带调试端口起来
Start-Process 'D:\CloudMusic\cloudmusic.exe' -ArgumentList '--remote-debugging-port=9229','--remote-debugging-address=127.0.0.1'
# 再跑探测
node research\probe29.mjs 9229
```

> ⚠️ `probe24` ~ `probe28` 那几支会在 app 里注入假播放状态，跑完客户端会处于半坏状态，
> 得重启客户端才能恢复。正常用的时候别去碰它们。
