# 系统定位写入入口审计

日期：2026-10-16。目标：Mate 80 Pro（SGT-AL50），`7.0.0.109(SP6C00E105R3P3)`，API 26；运动世界 `com.zjwh.hm_wh_physicalfitness`，7.3.92。

当前结论：**testhelper GPX 已实际改变独立读取应用收到的系统坐标，USB G0–G2 通过。** 2026-10-17 的[真机证据](evidence/2026-10-17-reader-device-probe.json)记录两点、连续序列、有线恢复及拔线失败范围。运动世界兼容性和脱机仍未证实。以下20:04启停及权限调查为历史记录。

## 0. 20:04 新入口与实测修正

用户提供的答复指出 testhelper；复查系统文件清单发现该工具原本就在手机中，之前按 location／gnss／mock 检索名称未覆盖它。真机帮助列出 `enable-location-mock`、`set-mocked-locations <path> [interval]`、`disable-location-mock`，实测版本为 1.0.1。

启用返回 `Enable location mock successfully.`；紧接着在 finally 中关闭，返回 `Disable location mock successfully.`。没有传输 GPX，没有设置坐标。见[实测 JSON](evidence/2026-10-16-testhelper-smoke.json)。尚无独立正常位置基线或恢复坐标，不能把工具返回成功写成 G1／G2 通过。

已核对 OpenHarmony 官方[辅助测试工具指导](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/application-test/testhelper-guidelines.md)，保存内容 blob SHA 为 `c8185d4060ef455ab59108b9e2f9b6115f236556`。文档记载 GPX 位于 `/data/local/tmp`，点数最多 1000，间隔为 1–3600 秒整数、默认 1 秒；尚未在本机实测这些边界。

**结论修正：** hdcd 没有 MOCK_LOCATION 不能推出系统内置 testhelper 不可用；普通应用取得系统模拟权限不再是工具路线的前置条件。下一项是签名安装普通读取应用，再做正常位置基线、两个固定点、短序列与恢复验证。运动世界兼容性和拔线保持策略仍未知。后文原权限审计不构成对工具路线的否定。

## 1. 查到的候选调用链

OpenHarmony 官方源码包含以下调用链：

1. `EnableLocationMock`：开启模拟。
2. `SetMockedLocations`：提交带时间间隔的位置序列。
3. `DisableLocationMock`：关闭模拟。

上游 `LocatorAbility` 在写入前检查调用身份与模拟定位权限；该版本的开启路径还检查开发者模式和 USB 状态，并在 USB 状态变化时处理停止模拟。因此不能根据源码承诺商用机可用或拔线后能继续运行。

源码固定到提交 `4c5dca7cf9faeae4da0ba833945770600129e2dc`：[定位服务实现](https://github.com/openharmony/base_location/blob/4c5dca7cf9faeae4da0ba833945770600129e2dc/services/location_locator/locator/source/locator_ability.cpp)、[权限校验实现](https://github.com/openharmony/base_location/blob/4c5dca7cf9faeae4da0ba833945770600129e2dc/frameworks/location_common/common/source/permission_manager.cpp)。

权限实现将模拟权限交给权限管理器验证；身份检查区分 Native、获认证的 CLI 工具、Shell 和系统 HAP。不能将 UID 2000、USB 连接或普通 HAP 定位读取授权当作通过这些检查的证据。上游源码不是本机商用二进制实现的逐项证明。

## 2. 真机取得的权限证据

使用系统自带工具帮助确认参数后，实际执行了只读查询：

```text
atm dump -d -p ohos.permission.MOCK_LOCATION
atm dump -t -n hdcd
atm dump -t -n shell
```

本机返回：

| 字段 | 实际值 | 含义与限制 |
| --- | --- | --- |
| permissionName | `ohos.permission.MOCK_LOCATION` | 本机确实定义了该权限 |
| grantMode | `SYSTEM_GRANT` | 系统授权方式，不能当作普通用户权限弹窗 |
| availableLevel | `SYSTEM_BASIC` | 系统基础等级 |
| availableType | `SYSTEM` | 系统类型准入限制 |
| provisionEnable | `true` | 存在证书配置机制；不证明本项目可申请、获批或取得系统应用身份 |

`hdcd` 的查询结果为 UID 2000，返回的已授权列表不包含 `MOCK_LOCATION`；系统中未查询到名称为 `shell` 的独立 Native Token。后者不能代替对当前进程自身权限的 API 检测。

用户还确认：已经开启的开发者选项中没有“选择模拟位置信息应用”“模拟位置”等入口。

完整脱敏审计数据见[权限审计证据](evidence/2026-10-16-location-permission-audit.json)。原始权限工具输出保留在本机私有执行目录。

## 3. 已做的额外探针及真实结果

为排除仅凭 HDC 服务清单推断当前进程权限的误差，编写了[只读自身权限探针](../../prototype/permission-probe/README.md)。源码使用 SDK 公开 API，不申请额外权限。

探针编译、ELF 架构检查、传输摘要校验均已完成；但手机在文件已经有所有者执行位的情况下返回 `Permission denied`。因此原型未进入权限检查代码，没有自身权限返回值，更没有调用任何定位写入 API。

该错误的具体系统拦截机制尚未确认，不能直接归因为 SELinux 或代码签名。华为[原生调试指南](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/debug-lldb)区分 root 环境和 user 环境，并说明 user 环境的原生调试范围涉及 DevEco 编译签名的 debug HAP；它提供的是进一步测试准备依据，不是模拟定位授权证明。

临时程序及其空目录已经清理并确认不存在，见[清理证据](evidence/2026-10-16-permission-probe-cleanup.json)。未执行 root、关闭安全机制、权限授予、系统文件修改或运动记录操作。

## 4. 还缺少什么

华为[自动签名指南](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-signing-auto)提供 ACL／Profile 申请流程，并链接到[受限开放权限](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/restricted-permissions)。本轮已解析到这份新版清单的准确地址，但抓取未成功，尚无证据说明 `MOCK_LOCATION` 对本项目开放。

可以恢复定位写入试验的条件是以下任一项获得明确依据：

- 华为提供适用于该商用构建的官方真机定位模拟入口，以及授权、停止和恢复说明。
- 本项目实际取得可通过相关身份检查的签名／应用身份，并取得 `MOCK_LOCATION` 授权；需要核实权限范围、期限和目标设备绑定，不能仅在配置文件中添加权限名。

准备了[官方能力核实问题](official-location-capability-questions.md)，供用户在华为开发者支持渠道查询；未发送给任何第三方。

取得准入依据后，仍需按计划完成两个固定点的独立位置读取、连续移动、停止恢复，再核实运动世界实际读取结果。**当前没有这些结果，不宣称应用已被改变定位。**

## 5. 授权准备进展

用户已确认拥有实名认证的华为开发者账号。已按已核实的设备、权限和诊断结果准备[正式咨询正文与提交说明](huawei-support/README.md)，并生成脱敏证据压缩包；附件校验和与设备完整标识排除检查已通过。

当前阶段是“咨询材料可提交”，不是“已申请权限”。未创建 AGC 应用，未发送咨询，未取得 Profile 或模拟定位授权。浏览器重置后连续两次读取超时，不能代替账号本人登录后的页面核实与提交。准备状态见[授权准备证据](evidence/2026-10-16-authorization-preparation.json)。

本轮通过官方页面公开资源补充核对文档读取方式，但未取得新版受限权限正文；页面壳、空 CMS 元数据及别名查询失败都不构成权限开放或不开放的结论。下一项可推进的外部动作是由账号本人通过官方支持入口提交已经准备的能力咨询，取得明确的入口和身份／授权答复。
