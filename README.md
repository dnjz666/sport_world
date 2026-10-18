# HarmonyOS 操场轨迹定位验证项目

面向华为 Mate 80 Pro，验证通过官方调试工具向系统提供测试位置，并由独立应用读取实际坐标。按已批准设计先做真机验证，再实现 USB 轨迹工具，最后依据实测决定脱机方案。

**2026-10-18：USB M0、任务 3–6 已完成。** 已提供桌面基础、时间驱动轨迹引擎、USB 定位执行器、独立读取通道及会话状态／日志／恢复判定；本地控制服务和界面待任务 7。任务 5 已合并到 main；任务 6 在当前目录的开发分支完成，本轮未操作手机。任务 5 复验结束时模拟已关闭、本次临时文件已清理，此处不表示手机当前状态。

| 项目 | 结果 |
| --- | --- |
| 系统写入入口 | 真机 testhelper 1.0.1；启用、GPX 下发、关闭均实测成功 |
| 独立读取应用 | 普通调试签名 HAP 构建、安装及精确定位授权成功，取得实际回调 |
| 固定点 | 两点相距 133.434 米，13／11 个样本均满足 5 米误差判据 |
| 连续移动 | 19 个不同位置跨 18 秒；设置命令返回后仍持续更新 |
| 有线停止恢复 | 首次试验及独立复核通过，取得关闭后带新时间的正常位置 |
| 拔线继续运行 | 未证实；16.371 秒断线内无可用样本，原基线恢复有未解释偏差，详见报告 |
| 运动世界读取／轨迹／记录 | 尚未验证；本轮没有启动或提交运动记录 |
| 定位适配复验 | 两固定点通过；原基线恢复出现约 51 米偏差而未通过，另一次新稳定基线下的 USB 停止恢复通过，失败保留 |
| 桌面模块 | 任务 3–6 已完成，85 个测试通过；任务 7–9 尚未开始 |

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

后续开发在当前项目目录从 `main` 新建 `codex/` 开发分支，不再单独创建隔离工作树；具体规则见 [AGENT.md](AGENT.md)。

任务 3–6 的模块与使用见 [桌面模块说明](desktop/README.md)，验证见[任务 3 报告](docs/verification/task3-desktop-foundation.md)、[任务 4 报告](docs/verification/task4-time-driven-replay.md)、[任务 5 报告](docs/verification/task5-verified-executor.md)及[任务 6 报告](docs/verification/task6-session-journal.md)。在仓库根目录使用 Node 26.1.0 或更高版本：

```powershell
npm ci
npm run build
npm test
```

会话控制器在关闭后仍等待独立恢复样本；原会话基线偏差、清理失败或超时保留 recovery_required，不能换新基线覆盖失败。当前模块由调用方调度，`npm start` 的本地控制服务与界面入口留待任务 7；`mobile/` 尚未建立。运动世界兼容性按任务 8 验收，手机独立运行按任务 9 单独验收。实际设备执行仍须独立检查目标、权限和恢复，不由合成测试推出。
