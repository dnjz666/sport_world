# HarmonyOS 操场轨迹定位验证项目

面向华为 Mate 80 Pro，验证通过官方调试工具向系统提供测试位置，并由独立应用读取实际坐标。按已批准设计先做真机验证，再实现 USB 轨迹工具，最后依据实测决定脱机方案。

**2026-10-18：USB M0、任务 3–7 已完成；任务 8 本轮验收结束，未整体通过。** 闭合控制路线两圈、暂停、独立终点、手动停止及断线重连后的原基线恢复已观察。较长会话 Ctrl+C 在 60 秒时仍未完成自动恢复，已另按原日志人工复核；运动世界测试定位提示“定位失败”，关闭后正常定位成功。终点过早关闭问题已修复，严格构建及 115 个测试通过。后续直接在 main 开发，见[USB 验收](docs/verification/usb-acceptance.md)、[运动世界结论](docs/verification/sport-world-compatibility.md)及[使用说明](docs/user-guide.md)。

**追加兼容性排查进行中：** 正常对照已取得运动世界成功的网络位置回调，用户确认地图正常、开始跑步提示信号弱；测试位置兼容性仍未解决。长会话已改为批量核对和清理自有文件，真机 80 文件清理约 3.3 秒，完整 SIGINT 恢复仍待复验。读取器 1.1.0 已构建安装并开始正常诊断，严格构建及完整 128 项测试通过；单点对照因正常新基线回调不足而未启用模拟。

| 项目 | 结果 |
| --- | --- |
| 系统写入入口 | 真机 testhelper 1.0.1；启用、GPX 下发、关闭均实测成功 |
| 独立读取应用 | 普通调试签名 HAP 构建、安装及精确定位授权成功，取得实际回调 |
| 固定点 | 两点相距 133.434 米，13／11 个样本均满足 5 米误差判据 |
| 连续移动 | 19 个不同位置跨 18 秒；设置命令返回后仍持续更新 |
| 有线停止恢复 | 首次试验及独立复核通过，取得关闭后带新时间的正常位置 |
| 拔线继续运行 | 未证实；16.371 秒断线内无可用样本，原基线恢复有未解释偏差，详见报告 |
| 运动世界读取／轨迹／记录 | 用户报告测试定位失败、关闭后正常定位成功；本轮兼容验收未通过，轨迹和最终记录未验证 |
| 定位适配复验 | 两固定点通过；原基线恢复出现约 51 米偏差而未通过，另一次新稳定基线下的 USB 停止恢复通过，失败保留 |
| 桌面模块 | 任务 3–7 已完成，追加修复后 128 个测试通过；任务 8 部分已验收，完整退出复验和目标应用仍未通过，实测操场未验证，任务 9 未开始 |

证据及拔线限制见 [M0 结果](docs/verification/m0-results.md)和[脱敏真机证据](docs/verification/evidence/2026-10-17-reader-device-probe.json)。`verifiedStandalone` 保持 false。持续 USB 是当前开发路线；工具成功或系统定位改变都不能自动证明运动世界认可记录。

## 已核实环境

| 项目 | 记录 |
| --- | --- |
| 手机／系统 | Mate 80 Pro，SGT-AL50；HarmonyOS 7.0.0.109（SP6C00E105R3P3），API 26 |
| 测试对象 | 运动世界 7.3.92，`com.zjwh.hm_wh_physicalfitness` |
| 独立读取应用 | `com.example.m0locationreader` |
| HDC | 3.2.0d，`tools/hdc/hdc.exe`，服务 `127.0.0.1:8710` |
| 最新实际构建 | DevEco Studio 26.0.0.851、SDK 26.0.0.105（API 26）、Hvigor 6.26.8 |
| 早期 CLI 构建 | Node 18.20.1、Hvigor 6.24.5、SDK 6.1.1.125（API 24） |

编译 SDK 由构建环境选择，目标 API 24／最低兼容 API 12 保持不变；API 26 构建已在本机安装运行。选定工具文件签名和解压 CRC 已检查，工具包整包摘要尚未与官网比对。设备标识、位置原始数据与签名材料保留本机，签名 HAP 不公开分发。

## 目录与操作入口

```text
AGENT.md                       单一执行规范，无映射或重复规则文件
docs/superpowers/specs/         已批准设计
docs/superpowers/plans/         任务、接口与验收步骤
docs/verification/             真机结果及脱敏证据
desktop/                      TypeScript 基础库、轨迹引擎、合成测试与使用说明
prototype/reader/              独立读取工程
prototype/probe/               testhelper 已验证调用与限制
prototype/permission-probe/    历史只读权限诊断
tools/                        忽略的本机官方工具／缓存
.superpowers/                 忽略的执行账本／原始证据
```

读取应用已经安装，手机点击“开始读取”可订阅系统位置，点击“停止读取”或离开页面取消订阅。取消读取不会关闭系统模拟。构建、签名及当前 IDE 命令见[读取工程说明](prototype/reader/README.md)，写入与恢复见[入口说明](prototype/probe/README.md)。

本机只读设备列表：

```powershell
& D:\code\sport_world\tools\hdc\hdc.exe -s '127.0.0.1:8710' list targets -v
```

设备操作必须显式指定已核实的 USB 目标；不选择 UART，不在掉线后自动换设备。模拟停止后还要取得新正常位置，不能只看成功提示。

## 接续开发

执行前读 [AGENT.md](AGENT.md)、[设计](docs/superpowers/specs/2026-10-16-harmonyos-track-location-design.md)、[实施计划](docs/superpowers/plans/2026-10-16-harmonyos-track-location-plan.md)和 [M0 结果](docs/verification/m0-results.md)。用户已选择在本会话顺序执行，常规已授权步骤连续推进，实际外部条件再具体交接。

后续开发直接在当前项目目录的 `main` 分支完成，不再新建开发分支或隔离工作树；具体规则见 [AGENT.md](AGENT.md)。

任务 3–7 的模块与使用见 [桌面模块说明](desktop/README.md)，验证见[任务 3 报告](docs/verification/task3-desktop-foundation.md)、[任务 4 报告](docs/verification/task4-time-driven-replay.md)、[任务 5 报告](docs/verification/task5-verified-executor.md)、[任务 6 报告](docs/verification/task6-session-journal.md)及[任务 7 报告](docs/verification/task7-local-control.md)。在仓库根目录使用 Node 26.1.0 或更高版本：

```powershell
npm ci
npm run build
npm test
npm start
```

打开终端打印的 http://127.0.0.1 随机端口地址，明确选择设备，填写或导入 WGS-84 路线，预览后应用配置，再开始运行。修改输入或结束一次会话后需重新应用配置。默认读取本机 docs/verification/m0-report.json，可用 M0_REPORT_PATH 覆盖；HDC_PATH 可指定工具路径。缺少有效能力报告时页面显示能力未确认，不能开始模拟。

关闭浏览器页面不会停止服务；请使用页面停止按钮并等待恢复确认。Ctrl+C 会关闭服务、尝试停止并等待读取，失败或超时仍报告未确认。会话控制器始终保留原基线约束；重启不能替代旧会话恢复。日志留在忽略的 local-data/sessions/，操作与异常恢复详见[桌面说明](desktop/README.md)。`mobile/` 尚未建立，脱机按任务 9 单独验收。
