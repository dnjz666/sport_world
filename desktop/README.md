# 桌面基础、轨迹引擎与定位适配器（任务 3–5）

当前提供 TypeScript 基础模块、时间驱动轨迹引擎、已验证的 USB 定位执行器及独立读取通道；控制界面和完整会话控制待后续任务。

## 构建与测试

本轮环境：Node 26.1.0、npm 11.13.0；精确锁定 TypeScript 7.0.2、@types/node 26.6.5，传递依赖由 package-lock.json 固定。源码使用 NodeNext／ES2022 严格类型检查，测试导入 desktop/dist 的编译产物。

在仓库根目录运行：

```powershell
npm ci
npm run build
npm test
```

任务 3 已从锁文件离线重新安装依赖；任务 5 接入后全量 60 个测试通过。node_modules 和 dist 均不提交；npm test 不连接手机。npm start 的服务入口在任务 7 实现后才可用。

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

## 输入约定

路线格式见[合成方形样例](tests/fixtures/track.json)。样例位于赤道附近，纯属单元测试数据，不是实际操场或真机定位证据。首点可省略重复闭合点，也可在末尾写一次；连续重复点、零长度段及闭合连接超过 500 米均拒绝。500 米是本产品的操场输入规则。

parseRoute 接受 JSON 文本或对象；compileRoute 也自行校验并复制数据。pointAtDistance 接受非负有限累计距离，按总长度取模，正反向走同一闭合路线；整圈回到首点，拐点朝向下一段。

capabilitiesFromReport 的 proofPath 指向保存的 ProbeReport JSON，报告内容须与传入对象一致。evidencePaths 中的相对路径从当前仓库工作目录解析，绝对路径可直接使用。外部目录启动时须设定正确工作目录或提供绝对证据路径。该检查用于防止误用缺失、过期或错误设备的报告，不把本地 JSON 当作签名授权机制；实际连接仍通过 HdcClient 独立核实。

HdcClient.runTarget(targetId, args, options) 每次先核对显式 USB 目标，再保留独立 -t 参数执行非交互 shell／file 命令。options.signal 同时覆盖 USB 查询和命令；options.beforeRun 是 USB 查询后、实际派发前执行的同步守卫，由执行器复查授权。适配器使用固定远端命令、随机专属路径与校验后的参数；不能将任意界面文本拼成 hdc shell 命令。

验证范围及限制见[任务 3 报告](../docs/verification/task3-desktop-foundation.md)和[任务 4 报告](../docs/verification/task4-time-driven-replay.md)。

## 已验证定位执行与独立读取

createVerifiedExecutor(capabilities, hdc, observer) 返回一次会话使用的执行器。prepare 接受 sessionId、显式 targetId 和 usb 模式，核对本机保存的真实能力报告、当前系统构建及期限，建立读取通道并启用模拟。当前适配器拒绝 standalone，即使传入自称支持脱机的标志也不走未验证路径。

send 校验 Sample 并生成一个 WGS-84 GPX 点，以明确的绝对本机路径和完整远端文件路径传输，核对 SHA-256 后调用 testhelper set-mocked-locations，间隔参数固定为已验证的 1 秒。GPX 包含坐标和时间；不声称写入原生速度或朝向，调用耗时也不保证 1 Hz。序号须递增，失败后先 stop 再新建实例。

prepare／send／stop 串行执行。调用方应在 finally 中 stop；stop 在授权过期后仍可关闭同一目标，关闭成功后只删除本实例路径且摘要一致的 GPX，最后删除空目录。不返回“正常定位已恢复”，恢复须由任务 6 的控制器对照停止后的独立样本判断。停止失败可重试；文件摘要不一致则保留并返回失败。

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
