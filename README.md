# HarmonyOS 操场轨迹定位验证项目

面向华为 Mate 80 Pro，验证通过官方调试工具向系统提供测试位置，并由独立应用读取实际坐标。按已批准设计先做真机验证，再实现 USB 轨迹工具，最后依据实测决定脱机方案。

**2026-10-17：USB 方式的 M0（G0／G1／G2）已通过，桌面产品尚未开始。** 模拟已关闭，本轮手机临时文件已清理。此处记录验证结果，不表示手机当前连接状态。

| 项目 | 结果 |
| --- | --- |
| 系统写入入口 | 真机 testhelper 1.0.1；启用、GPX 下发、关闭均实测成功 |
| 独立读取应用 | 普通调试签名 HAP 构建、安装及精确定位授权成功，取得实际回调 |
| 固定点 | 两点相距 133.434 米，13／11 个样本均满足 5 米误差判据 |
| 连续移动 | 19 个不同位置跨 18 秒；设置命令返回后仍持续更新 |
| 有线停止恢复 | 首次试验及独立复核通过，取得关闭后带新时间的正常位置 |
| 拔线继续运行 | 未证实；16.371 秒断线内无可用样本，原基线恢复有未解释偏差，详见报告 |
| 运动世界读取／轨迹／记录 | 尚未验证；本轮没有启动或提交运动记录 |
| 完整桌面／手机产品 | 任务 3–9 尚未开始；下一项为桌面基础与路线校验 |

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

下一项为计划任务 3。根目录产品 `package.json`、`desktop/` 和 `mobile/` 尚未建立，不运行尚不存在的根级 `npm run build`／`npm start`。Git 已建立，本地初始快照用于保存设计、读取原型及脱敏 M0 证据；产品代码开始前安排隔离，保留本机签名配置及所有忽略规则。运动世界兼容性按任务 8 验收，手机独立运行按任务 9 单独验收。
