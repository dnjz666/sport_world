# M0 独立定位读取原型

使用公开 `geoLocationManager` 订阅真实系统定位，不包含定位写入代码，只声明精确／大致定位读取权限。

2026-10-18：诊断版 **1.1.0 已签名构建并安装**；新增系统原生速度／方向、各自精度、回调间隔、位置时间差、原始来源和卫星／错误事件。原 M0 证据仍绑定当时的 1.0.0 源码／产物摘要，不以新版覆盖历史证明。兼容性诊断见[运动世界报告](../../docs/verification/sport-world-compatibility.md)。

**2026-10-17 已完成普通调试签名构建、真机安装、位置授权和真实样本导出。** 固定点、连续轨迹与有线停止恢复通过；拔线继续运行及运动世界兼容性未证实。证据见 [M0 结果](../../docs/verification/m0-results.md)及[本轮真机证据](../../docs/verification/evidence/2026-10-17-reader-device-probe.json)。

## 工程与签名

Stage 结构参考 OpenHarmony 官方 [Location 样例](https://github.com/openharmony/applications_app_samples/tree/a826ab0e75fe51d028c1c5af58188e908736b53b/code/BasicFeature/DeviceManagement/Location)，按随包 Hvigor schema、SDK 声明和实际编译诊断适配；源码为本项目 M0 编写，不是 IDE 向导导出的工程。

当前使用 DevEco Studio 26.0.0.851／API 26 SDK 26.0.0.105／Hvigor 6.26.8。已移除早期固定 API 24 的 compileSdkVersion，目标 API 24／最低兼容 API 12 不变。三个定位系统能力的设备适用性警告保留，当前真机已实际收到回调。

应用标识 `com.example.m0locationreader`。用户通过 DevEco 自动调试签名生成材料，检查 Profile 为 debug、normal、hos_normal_app，绑定一个调试设备。本机 products.default.signingConfig 已关联 default；签名 HAP 构建、安装和启动均成功。系统 testhelper 路线不要求读取应用申请 MOCK_LOCATION。

`build-profile.template.json5` 无凭据；本机 `build-profile.json5`、Profile、密钥库及签名 HAP 保留本机，不覆盖回模板或发送到聊天。签名 HAP 含设备绑定信息，不能当通用安装包分发。换账号、手机或 Profile 到期时依照[官方自动签名说明](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-signing-auto)重新配置。

## 本机实际构建方式

以下为本轮成功签名构建使用的进程级环境与命令，需本机签名配置已经就绪：

```powershell
$taskIde = 'D:\code\devecostudio-windows-26.0.0.851\DevEco Studio'
$env:HVIGOR_USER_HOME = 'D:\code\sport_world\tools\hvigor-ide26-user'
$env:DEVECO_SDK_HOME = Join-Path $taskIde 'sdk'
$env:DEVECO_NODE_HOME = Join-Path $taskIde 'tools\node'
$env:JAVA_HOME = Join-Path $taskIde 'jbr'
$env:npm_config_cache = 'D:\code\sport_world\tools\npm-cache'
$env:PATH = "$env:DEVECO_NODE_HOME;$env:JAVA_HOME\bin;$env:PATH"
Set-Location 'D:\code\sport_world\prototype\reader'
& (Join-Path $taskIde 'tools\node\node.exe') (Join-Path $taskIde 'tools\hvigor\bin\hvigorw.js') --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

历史 1.0.0 签名产物为 73,456 字节，摘要在原 M0 证据中。1.1.0 初次真机诊断产物为 92,560 字节；审查修复取消订阅失败后的重启提示，重新签名的当前产物为 92,541 字节，仍位于 `entry/build/default/outputs/default/entry-default-signed.hap`。两个版本快照的源码和产物摘要分别保留本机，当前修复产物尚待安装。`build.ps1` 仍使用早期 tools/cli 的 API 24 工具，不能当成本轮 IDE API 26 命令；它只在本机配置缺失时复制模板，不覆盖签名配置。工程无外部依赖，hvigor.dependency.useNpm=true 使用随包插件。

## 真机读取与证据

在手机点击“开始读取”，允许精确定位并保持页面前台亮屏；只有实际 callback 才增加计数。停止读取或离开页面取消订阅。读取程序目前没有保持屏幕常亮功能，受控试验通过实际 UI 操作维持亮屏；锁屏阻止自动启动时需本人解锁，不绕过锁屏。

ObservedLocation 包含系统经纬度、原生位置时间戳 epochMs、Date.now() 接收时间、精度和可用时的原始 sourceType 数值文本。1.1.0 原样读取 API 26 的可选 isFromMock 字段至 isMock，不可用时保留 null；不隐藏或修改标记。1.0.0 的 isMock 固定 null，原 M0 速度／方向仍是从坐标与时间推导的历史结果。

1.1.0 的 `M0ReaderDiagnostic` 独立日志记录原生 speed、direction、speedAccuracy、directionAccuracy、timeSinceBoot、位置时间差及实际回调间隔；未提供或非有限数值保留 null，不用推导值填充。公开 `satelliteStatusChange` 只报告卫星数量与最强载噪比，不代表已经得到 GNSS 定位；`locationError` 保留原始错误码。可选诊断订阅失败会记录原因，不阻止主定位读取；停止／离开页面会逐一取消订阅，取消失败可重试。

页面提供精度优先（默认 ACCURACY）、轨迹场景（UNSET + TRAJECTORY_TRACKING）及低功耗（LOW_POWER）三个公开请求模式，保持 timeInterval=1、distanceInterval=0、maxAccuracy=0。切换时先停止旧订阅；模式由系统选源，不是 GNSS 强制开关，也不保证 1 Hz。正常定位可在未开启模拟时断开 USB、保持读取页前台采集，再接回导出本机日志；这不证明脱机模拟可用。

每个真实回调以 HiLog 标签 M0Reader 输出 JSON。`hilog -x -T M0Reader,M0ReaderStatus` 已实际导出样本；原始日志及精确坐标仅保留忽略的本机执行目录，公开证据使用摘要、数量及误差。G1 的 5 米判据没有放宽；恢复正常 GNSS 使用独立预声明的 50 米半径。

物理拔线约 16 秒没有取回可用样本，且原基线恢复出现约 107 米偏差；该失败保留。后续独立 USB 启停复核通过。不要把本原型的有线通过写成运动世界兼容或手机可独立控制模拟。
