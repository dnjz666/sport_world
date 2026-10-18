# 本地轨迹控制台与桌面模块（任务 3–7）

当前提供本机回环控制服务、路线编辑与预览界面、时间驱动轨迹引擎、USB 定位执行器、独立读取通道及会话控制／日志。任务 8 已观察闭合控制路线及独立终点恢复，实测操场和运动世界兼容性以[真机验收](../docs/verification/usb-acceptance.md)为准，操作见[用户说明](../docs/user-guide.md)。

## 构建与测试

本轮环境：Node 26.1.0、npm 11.13.0；精确锁定 TypeScript 7.0.2、@types/node 26.6.5，传递依赖由 package-lock.json 固定。源码使用 NodeNext／ES2022 严格类型检查，测试导入 desktop/dist 的编译产物。

在仓库根目录运行：

```powershell
npm ci
npm run build
npm test
```

任务 3 已从锁文件离线重新安装依赖；任务 8 终点修复后全量 115 个测试通过。node_modules 和 dist 均不提交；npm test 需要本机回环连接，不连接手机。构建后运行 npm start 启动控制台。

npm test 仅发现 desktop/tests/*.test.mjs，避免将本机 tools 目录中 SDK 自带的测试作为项目测试运行。新增桌面测试沿用该目录和命名约定。

若系统浏览器／PowerShell 能连接 npm，而 npm 超时，可核对 npm 是否沿用系统已有代理。本轮只为安装进程设置代理，未改全局配置、关闭 TLS 校验或切换镜像；常规环境无需此调整。

## 模块

| 文件 | 行为 |
| --- | --- |
| [types.ts](src/core/types.ts) | 与已批准计划一致的路线、能力、采样、时钟及会话类型 |
| [process.ts](src/hdc/process.ts) | 参数数组、shell:false、隐藏 Windows 子窗口；保留两条输出流及退出码，支持 AbortSignal |
| [client.ts](src/hdc/client.ts) | 固定已验证 HDC 服务 127.0.0.1:8710，仅返回 Connected USB；requireTarget 必须明确选择且每次重新查询，掉线不换设备 |
| [route.ts](src/core/route.ts) | JSON／对象解析，WGS-84、有限范围、三个不同点、零长度及 500 米连接检查；闭合一次、累计长度、正反向沿线位置 |
| [replay.ts](src/core/replay.ts) | 注入单调时钟的配速、暂停与继续、正反向圈数和单次终点样本 |
| [geo.ts](src/core/geo.ts) | 半径 6371008.8 米的球面距离、短弧插值和当前位置朝向 |
| [capabilities.ts](src/probe/capabilities.ts) | 对照保存的报告、目标／系统、G0–G2、期限及实际证据文件，条件缺失则禁用能力 |
| [contract.ts](src/executor/contract.ts) | LocationExecutor、PositionObserver、SendReceipt 和 StopReceipt 跨任务接口 |
| [verified-executor.ts](src/executor/verified-executor.ts) | 已验证 testhelper 的单点 GPX 传输、摘要检查、启用／设置／关闭及自有文件清理 |
| [observer.ts](src/executor/observer.ts) | 从当前独立读取应用 PID 的 M0Reader HiLog 获取真实回调，过滤过期和旧进程样本 |
| [session.ts](src/core/session.ts) | 配置快照、开始／暂停／继续／停止、连接代次、独立基线与恢复判定 |
| [journal.ts](src/logging/journal.ts) | 串行 JSONL 事件、凭据过滤、输入快照及可见的写入错误 |
| [server.ts](src/server.ts) | 127.0.0.1 随机端口、JSON API、同来源检查、静态资源白名单及 250 毫秒 tick 调度 |
| [index.ts](src/index.ts) | 环境变量、能力报告、执行器／读取器装配、私有日志及退出清理 |
| [web/](web/index.html) | 设备选择、路线编辑／导入与形状预览、控制及三类位置／恢复状态 |

## 输入约定

路线格式见[合成方形样例](tests/fixtures/track.json)。样例位于赤道附近，纯属单元测试数据，不是实际操场或真机定位证据。首点可省略重复闭合点，也可在末尾写一次；连续重复点、零长度段及闭合连接超过 500 米均拒绝。500 米是本产品的操场输入规则。

parseRoute 接受 JSON 文本或对象；compileRoute 也自行校验并复制数据。pointAtDistance 接受非负有限累计距离，按总长度取模，正反向走同一闭合路线；整圈回到首点，拐点朝向下一段。

capabilitiesFromReport 的 proofPath 指向保存的 ProbeReport JSON，报告内容须与传入对象一致。evidencePaths 中的相对路径从当前仓库工作目录解析，绝对路径可直接使用。外部目录启动时须设定正确工作目录或提供绝对证据路径。该检查用于防止误用缺失、过期或错误设备的报告，不把本地 JSON 当作签名授权机制；实际连接仍通过 HdcClient 独立核实。

HdcClient.runTarget(targetId, args, options) 每次先核对显式 USB 目标，再保留独立 -t 参数执行非交互 shell／file 命令。options.signal 同时覆盖 USB 查询和命令；options.beforeRun 是 USB 查询后、实际派发前执行的同步守卫，由执行器复查授权。适配器使用固定远端命令、随机专属路径与校验后的参数；不能将任意界面文本拼成 hdc shell 命令。

验证范围及限制见[任务 3 报告](../docs/verification/task3-desktop-foundation.md)和[任务 4 报告](../docs/verification/task4-time-driven-replay.md)。

## 已验证定位执行与独立读取

createVerifiedExecutor(capabilities, hdc, observer) 返回串行执行器。prepare 接受 sessionId、显式 targetId 和 usb 模式，核对本机保存的真实能力报告、当前系统构建及期限，建立读取通道并启用模拟。仅初始状态或成功清理后可 prepare；重新准备会重置序号并使用新的专属目录。当前适配器拒绝 standalone，即使传入自称支持脱机的标志也不走未验证路径。

send 校验 Sample 并生成一个 WGS-84 GPX 点，以明确的绝对本机路径和完整远端文件路径传输，核对 SHA-256 后调用 testhelper set-mocked-locations，间隔参数固定为已验证的 1 秒。GPX 包含坐标和时间；不声称写入原生速度或朝向，调用耗时也不保证 1 Hz。序号须递增，失败后必须先成功 stop 才能重新 prepare。

prepare／send／stop 串行执行。调用方应在 finally 中 stop；stop 在授权过期后仍可清理已有会话的同一目标，关闭成功后只删除本实例路径且摘要一致的 GPX，最后删除空目录。新实例先核对有效证据与系统也可 stop，供控制器在采基线前关闭残留；重复 stop 会重新发出关闭命令。不返回“正常定位已恢复”，恢复由控制器对照停止后的独立样本判断。停止失败可重试；文件摘要不一致则保留并返回失败。

createPositionObserver(hdc, targetId).latest() 使用设备时间和当前读取应用 PID，查询 hilog -x -T M0Reader -P <pid>。首次轮询、读取进程重启或连接失败后重建新鲜度边界；缺少回调、回调过期或进程未运行返回 null，命令失败会抛错。来源和模拟标记不可读时保留 null。手机须运行已安装的独立读取应用，手动授权并保持前台亮屏。

真实复验需要持续 USB，且会修改系统测试定位。确认本机能力证据、签名与目标正确，解锁并打开读取页后，在仓库根目录显式运行：

```powershell
npm run build
node desktop/scripts/verify-executor-device.mjs --run-device-check
```

[复验脚本](scripts/verify-executor-device.mjs) 先关闭残留模拟并建立新基线，再测试两个点，在 finally 中停止，独立检查恢复并按摘要清理本次远端文件。原始命令、位置与 UI 证据保存到忽略的 local-data；不要公开这些文件。结果与限制见[任务 5 报告](../docs/verification/task5-verified-executor.md)。

## 轨迹引擎

从 core/replay.js 导入 createReplay(route, settings, clock)，route 使用 compileRoute 的结果；clock 注入 monotonicMs 与 epochMs，生产环境可分别使用 performance.now() 与 Date.now()。先 start，再由调用方按 sampleIntervalMs 调用 next；引擎本身不启动定时器，每次只返回一个当前 Sample，序号从 1 开始。

pause 后 next 固定最后发出的坐标、朝向与 elapsedMs，更新 epochMs 且 speedMps 为零；resume 排除暂停时长，保留暂停前尚未采样的运行时间。首次采样前暂停时使用起点和零 elapsedMs。目标时长已到但终点未发出时，暂停仍固定最后样本，恢复后再发终点。重复 pause／resume 不改变进度，重复 start 或未启动采样会拒绝。

finished() 在唯一终点样本发出之后才返回 true，可使用“检查 finished → next”的调度方式。终点 elapsedMs 钳至目标时长、速度为零、位置回到起点；完成后 next／pause／resume 会拒绝。完成清理定位由后续会话控制器负责，再次运行需新建 Replay。

## 会话与日志

SessionController 构造参数沿用计划：replayFactory、executor、observer、journal、clock、hdc 和 capabilities。dispatch 接受 configure／start／pause／resume／stop；snapshot 返回深复制的 SessionSnapshot，分别保留 expected、sent（含回执）和 observed。configure 必须显式指定与能力一致的 USB 目标；活动会话的配置不可修改。

start 先核对能力、当前系统并主动 stop，再使用设备时间采集 5 个新的稳定基线回调（距中位点均不超过 10 米、精度不超过 50 米、未明确标记模拟），35 秒仍不足则报错且不 prepare。基线取得后才启用模拟。控制器不自行周期调度 tick；调用方在 running／paused／recovery_required 持续调用 tick，同代次并发调用合并。样本按 sampleIntervalMs 提交，调度延迟按实际经过时间计算当前位置。

任务 8 真机发现终点被提前清理的问题后，自动结束改为先等待独立终点：终点发送前建立设备毫秒时间边界，接受后最多等待 15 秒内新的回调，距终点不超过 5 米才自动清理；期限覆盖独立通道的 USB 读取。等待期间仍显示 running，但不再追加样本，暂停／继续报 TERMINAL_PENDING，手动停止仍立即清理。超时也关闭并记录 TERMINAL_OBSERVATION_TIMEOUT；后续 stopped 只表示原基线恢复，不会抹掉终点失败事件。

stop 立即使旧异步结果失效并进入 stopping，等待已开始的准备操作后清理。清理被接受后仍为 recovery_required；45 秒内至少 3 个不同的新回调须同时满足：在本次清理的设备时间边界之后、时间差不超过 5 秒、精度不超过 50 米、距原基线不超过 50 米、距所有尝试注入位置至少 100 米、未明确标记模拟，才进入 stopped。source／isMock 缺失仍保留 null，不能单凭 null 判正常。真实基线与路线过近时会保守地无法确认恢复。

断线、清理失败、错误位置、旧样本或超时都保留待恢复；断线重连后必须重新 stop，不能凭旧关闭回执确认恢复。显式重试 stop 会重建清理时间边界和 45 秒窗口，沿用原会话基线，未确认前禁止重新 configure／start。报告过期不阻止已有会话清理。任务 8 实际断线重连后的停止恢复通过；较长会话 SIGINT 退出自动恢复失败，另按原日志人工复核通过，见[真机验收](../docs/verification/usb-acceptance.md)。

createJournal(path) 将事件按调用顺序追加为 UTF-8 JSONL；请使用忽略的 local-data/sessions/ 下的路径。日志保存预期、提交回执、独立读取、原基线、清理、恢复边界／判据及错误；敏感字段、原生错误文本中的常见凭据赋值和私钥文本会被过滤。日志含精确坐标和目标标识，应留在本机。写入失败会暴露 JOURNAL_WRITE_FAILED，控制器仍尝试停止，修复日志后须重新建立控制器。恢复日志不能伪造补写。验收见[任务 6 报告](../docs/verification/task6-session-journal.md)。

## 启动与界面

在仓库根目录运行 npm run build，再运行 npm start，打开输出的本机 URL。端口由系统分配，只绑定 127.0.0.1；同一次服务运行请使用输出的原地址。默认 HDC 为 tools/hdc/hdc.exe，M0 报告为 docs/verification/m0-report.json。可在启动前用 PowerShell 的 `$env:HDC_PATH` 和 `$env:M0_REPORT_PATH` 指向其他路径。报告必须包含有效的已保存证据及匹配目标；缺少报告时仍可打开页面查看错误和设备，但不能启用模拟。相对证据路径依赖当前工作目录，建议从仓库根目录启动。

1. 解锁手机，打开独立读取应用并保持前台亮屏，维持 USB 连接。
2. 在设备列表明确选择目标。列表刷新保留原选择，掉线不会换成其他手机。
3. 填写路线名称及每行“纬度, 经度”，或导入现有 schemaVersion=1 的 WGS-84 路线 JSON；预览为闭合形状，无在线底图，不预填真实坐标或测试路线。
4. 填写配速（秒／公里）、圈数和方向，点击应用配置，再开始。界面输出间隔为 1 秒，实际派发耗时服从已验证工具；采基线期间可以点击停止取消开始。
5. 通过暂停／继续控制行进，停止后查看恢复判定。清理被接受不等于恢复成功；恢复待确认期间继续等待独立回调，掉线重连后重新停止。

输入变更、另一标签页替换配置、服务连接中断或一次会话结束后，需重新应用配置才可开始。刷新运行页面仍可查看／停止现有会话，圈数只显示当前圈，不将空白表单的默认圈数当作活动配置。旧页面的预览不代表其他页面当前应用的路线。

关闭浏览器页面不会停止服务。建议先在页面停止并等待恢复，再退出。Ctrl+C／SIGTERM 会先停止接收请求及后台调度，再尝试 stop 并驱动独立恢复检查；退出等待上限为 60 秒，本轮真实较长会话到期仍为 stopping，需人工处理。无法确认时终端报告未恢复，不返回成功结论。会话原基线目前保存在进程内，强制终止或机器重启后不会自动重建原会话；应保留私有日志，按[已验证入口说明](../prototype/probe/README.md)主动关闭并独立复核，不把新基线通过当成原会话恢复。

## 本地 API 与嵌入

| 接口 | 结果 |
| --- | --- |
| GET /api/state | 任务 6 的 SessionSnapshot |
| GET /api/targets | `{ targets: string[] }`，仅 Connected USB |
| POST /api/session | 任务 6 指令；成功返回快照，错误返回 `{ code, message }` |

POST 只接受 application/json（上限 256 KiB），Origin 必须与本次控制台 URL 完全相同；Host 也须匹配，不开放跨来源 CORS。页面携带 X-Session-Id，服务端在派发前检查会话是否已被替换，避免显示路线 A 却启动路线 B；紧急 stop 不受旧页面会话标识阻止。直接 API 客户端也应携带此头。损坏输入返回 400，非 JSON 为 415，超限为 413，外部来源为 403，会话拒绝为 409。

createControlServer(controller, hdc) 保持计划接口；其 close 关闭 HTTP 与调度资源，设备生命周期由调用者负责。推荐使用 createApplication() 装配；其 close 同时执行停止与恢复等待并返回最终快照，重复关闭共用同一次处理。createApplication 可接收 cwd／env／hdc 供嵌入与外部边界测试，生产入口使用当前环境和真实 HDC，不提供演示定位回退。验证见[任务 7 报告](../docs/verification/task7-local-control.md)。
