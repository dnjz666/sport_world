# M0 环境与定位入口调查

更新：2026-10-17，当前会话逐步执行。**USB M0 已通过。** DevEco Studio 26.0.0.851／SDK 26.0.0.105／Hvigor 6.26.8 已签名构建普通读取应用并安装授权，testhelper 1.0.1 的 GPX 实际改变独立应用收到的系统坐标。固定点、连续序列及有线停止恢复通过。

物理拔线约16秒未取回可用样本，原基线恢复存在107米偏差，原因未明；另以新稳定基线独立复核USB启停通过。脱机仍未证实，运动世界兼容性未测试。当前明细以 [M0 结果](m0-results.md)及[真机证据](evidence/2026-10-17-reader-device-probe.json)为准。后续较早权限／CLI调查按其日期和范围理解，不再以普通应用申请MOCK_LOCATION作为testhelper路线前提。

## 设备与应用

| 项目 | 当前记录 | 证据来源 |
| --- | --- | --- |
| 手机 | HUAWEI，型号 SGT-AL50；用户设备名为 Mate 80 Pro | HDC 读取型号、品牌及制造商 |
| 系统 | `SGT-AL50 7.0.0.109(SP6C00E105R3P3)`；API 26 | `param get const.product.software.version`／`const.ohos.apiversion` |
| 基础系统标识 | `OpenHarmony-7.0.0.105` | `param get const.ohos.fullname`；与产品软件版本是不同字段 |
| 目标应用 | `com.zjwh.hm_wh_physicalfitness`，版本 7.3.92，versionCode 1000114，entry 模块 | 用户打开运动世界；前台记录及 BundleManager 输出相互核实 |
| HDC 目标标识 | 已取得；可分享摘要为 `63Q0…5973` | 完整目标标识保留在本机报告和私有日志，不提交 |
| 当前连接条件 | USB Connected；已成功执行显式目标的只读 shell 命令 | `hdc -s 127.0.0.1:8710 list targets -v` 及后续读取 |
| 首版方式 | 可持续连接 USB，优先争取拔线运行 | 已批准设计 |

当前已核实前台应用对应上述鸿蒙应用包；包身份及版本不再依赖图标名称推测。没有启动运动记录或读取用户的运动数据。

## 电脑检查

早期检查保存至 [环境检查证据](evidence/2026-10-16-host-check.json)；接线后的检查保存至 [USB 识别证据](evidence/2026-10-16-usb-check.json)。早期缺少数据线及未发现手机的记录仅表示当时状态。

18:21 的 [调试接口证据](evidence/2026-10-16-debug-interface-check.json) 已确认 HDC Interface 正常。接口出现不代表 HDC 目标列表和设备授权已验证。

19:06–19:11 的 [HDC 实际连接与应用证据](evidence/2026-10-16-hdc-session.json) 已确认调试连接通过。上述早期“未安装工具”“未授权”等状态只表示当时情况。

- 未修改系统 PATH；HDC 现在通过绝对路径 `D:\code\sport_world\tools\hdc\hdc.exe` 调用，版本 `3.2.0d`。
- 检查的三个常见 Huawei 安装目录均不存在；未发现 DEVECO／OHOS／HARMONY／ANDROID 名称的环境变量。这不排除工具安装在其他目录。
- 隔离环境不能读取 CIM 设备信息；经授权的主机查询成功。早期查询未找到手机；18:16 接线后，限定当前存在设备的查询已识别 HUAWEI Mate 80 Pro，WPD 类别，状态 OK，USB 厂商／产品为 12D1／1101。报告省略序列号。
- 目标列表先返回 Unauthorized，用户完成手机授权后返回 Connected。列表中还出现 COM3／COM4 UART 条目，始终只选择明确识别的 USB 手机，没有操作 UART 目标。
- 调试命令身份为 `uid=2000(shell)`，SELinux 上下文 `u:r:sh:s0`；这不是系统应用身份或定位写入权限证明。

## 官方工具准备

官方来源为 [Command Line Tools 下载页](https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos)，获取方法见 [华为官方指南](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-commandline-get)。指南要求下载后检查工具完整性。

用户提供 `D:\code\commandline-tools-windows-x64-6.1.1.418.zip`，大小 2,600,751,070 字节。检查中心目录共 102,224 个条目：按原完整解压目录计算，26 个条目达到常见 260 字符限制，最长相对路径为 218 字符；示例位于 ETS 编译工具的深层依赖目录，与 HDC 无关。

仅提取 HDC、`libusb_shared.dll`、工具链元数据和许可证至项目 `tools/hdc/`。读取选定 ZIP 条目时 CRC 校验通过；HDC 与 DLL 的 Authenticode 均为 **Valid**，发布者 **Huawei Technologies Co., Ltd.**。HDC 已实际运行并连接手机，没有要求用户重新完整解压。

压缩包 SHA-256：`13338f9d313db76831a51be6ccbe4ba8c3340ea311431b3ca7fa4328d038c62f`。这只是本机文件摘要，**尚未对照官方整包摘要**；不能将选定文件 CRC／签名检查写成整包官方摘要已比对。提取文件的摘要和来源见本机 `tools/hdc/extraction-manifest.json`。

工具链元数据显示版本 `6.1.1.125`、API 24；手机实际 API 为 26。已证明这个 HDC 能完成设备连接及只读查询，不代表该包所有原生开发组件都匹配手机 API 26。

华为当前 [升级适配指南](https://developer.huawei.com/consumer/en/doc/harmonyos-releases/upgrade-adaptation) 对应 HarmonyOS 7／API 26，工具选择应核对匹配版本。该文档不能替代本机系统读取，也不证明定位模拟权限可用。

## 候选入口审查

本轮完成文档、已下载 SDK 和真机只读诊断范围的候选清单审查。API 24 的 ETS／JS 公开 `@ohos.geoLocationManager.d.ts` 均未找到 `enableLocationMock`、`setMockedLocations`、`disableLocationMock` 或 `MOCK_LOCATION` 声明；不能将它外推为 API 26 真机不存在相关系统能力。

| 候选 | 设备与调用主体 | 权限、签名及期限 | 停止与恢复 | 当前判定 |
| --- | --- | --- | --- | --- |
| 普通应用定位读取 | 公开定位读取应用；可作为独立观察端 | 用户定位授权，具体版本要求待 SDK 核对 | 取消读取订阅；本身不修改定位 | 不能作为定位写入入口 |
| Test Kit testhelper | 本机系统工具，经显式目标 HDC 调用；版本 1.0.1 | 未给项目申请或授予 MOCK_LOCATION；启停实测成功；GPX 与期限条件待验证 | disable-location-mock 返回成功；恢复坐标及断线行为另验 | 已取得启停证据；G0 进行中，G1／G2 待读取应用 |
| OpenHarmony `enableLocationMock`／`setMockedLocations` 系统接口 | 上游已定位对应服务调用链；本机构建可成功调用的路径未验证 | 真机实际定义为 SYSTEM_BASIC／SYSTEM_GRANT／SYSTEM，provisionEnable=true；项目身份、权限及商业签名可取得性／期限仍待核实 | 上游有禁用模拟接口及 USB 状态处理；本机异常退出、断线行为未试验 | 上游存在不等于目标手机可调用，G0 未通过 |
| HDC 调试通道 | 已连接目标手机，执行主体为 shell UID 2000 | 调试服务 hdcd 的已授权清单没有 MOCK_LOCATION；不能将清单当作自身权限 API 的返回值 | 断开 HDC 不等于定位已恢复 | 原生命令探针执行被拒；没有取得定位写入或进程自身权限结果 |
| IDE／模拟器位置模拟 | 模拟器环境及其工具 | 模拟器能力适用范围不能外推商用手机 | 按具体工具停止；不能替代真机恢复试验 | 不满足目标真机准入条件 |

真机 `LocationLocator` 的诊断帮助仅返回服务标题；`LocationGnss` 帮助只列出 `-h`。没有从这两个帮助输出取得定位写入或清理方法。没有尝试未记录的注入命令、授权变更、root 或系统文件修改。这些负面线索不足以单独判定 unsupported。

上游依据：[定位系统接口](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-location-kit/js-apis-geoLocationManager-sys.md)、[系统应用权限目录](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/security/AccessToken/permissions-for-system-apps.md)、[HDC 文档](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/dfx/hdc.md)。这些是 OpenHarmony 资料，不是 HarmonyOS 7.0.0.109 的能力证明。

商业签名条件还须对照 [华为自动签名指南](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-signing-auto) 与实际 SDK／签名结果，不能根据旧版本权限清单的遗漏宣布不支持。

新版受限权限清单准确地址已从该指南解析为 `doc/doccenter-capabilities/restricted-permissions`，但抓取未成功，没有据此宣布 MOCK_LOCATION 已开放或未开放。用户确认开发者选项没有模拟位置入口。详细证据及原型失败范围见写入入口审计。

## 恢复执行的顺序

1. 已完成 USB 连接、手机调试授权、选定 USB 目标及系统／应用身份读取。
2. 接下来需要取得适用于该 API 26 商用设备的官方定位写入入口依据，以及开发者实际可取得的身份、签名和授权路径；同时确认停止及异常恢复方法。
3. 只有 G0 有实际依据后才建立独立读取原型，进行两个固定点、连续移动与停止恢复试验。
4. G0–G2 全部通过后才能进入桌面轨迹产品任务。没有新 SDK、授权或官方依据时，不重复无边界搜索或预先开发假适配层。

20:04 更新：连接问题已解决，系统工具启停路径已证实；此前要求先取得应用系统权限的接续条件不再适用于 testhelper。下一步安装普通独立读取应用，再做基线与 GPX 实测。没有将工具返回成功、界面预览或合成数据作为独立读取证据。
