# 桌面基础库与轨迹引擎（任务 3–4）

当前提供 TypeScript 基础模块及时间驱动轨迹引擎，尚无控制界面或定位写入适配器。

## 构建与测试

本轮环境：Node 26.1.0、npm 11.13.0；精确锁定 TypeScript 7.0.2、@types/node 26.6.5，传递依赖由 package-lock.json 固定。源码使用 NodeNext／ES2022 严格类型检查，测试导入 desktop/dist 的编译产物。

在仓库根目录运行：

```powershell
npm ci
npm run build
npm test
```

已从 npm 生成的锁文件离线重新安装，并实际通过任务 3 的 26 个测试；任务 4 接入后全量 40 个测试通过。node_modules 和 dist 均不提交；测试不连接手机。npm start 的服务入口在任务 7 实现后才可用。

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

## 输入约定

路线格式见[合成方形样例](tests/fixtures/track.json)。样例位于赤道附近，纯属单元测试数据，不是实际操场或真机定位证据。首点可省略重复闭合点，也可在末尾写一次；连续重复点、零长度段及闭合连接超过 500 米均拒绝。500 米是本产品的操场输入规则。

parseRoute 接受 JSON 文本或对象；compileRoute 也自行校验并复制数据。pointAtDistance 接受非负有限累计距离，按总长度取模，正反向走同一闭合路线；整圈回到首点，拐点朝向下一段。

capabilitiesFromReport 的 proofPath 指向保存的 ProbeReport JSON，报告内容须与传入对象一致。evidencePaths 中的相对路径从当前仓库工作目录解析，绝对路径可直接使用。外部目录启动时须设定正确工作目录或提供绝对证据路径。该检查用于防止误用缺失、过期或错误设备的报告，不把本地 JSON 当作签名授权机制；实际连接仍通过 HdcClient 独立核实。

Task 3 只提供 HDC 设备查询和通用进程边界；任务 5 会在已验证适配器中补充显式目标命令调用、固定远端命令和参数校验。不能将任意界面文本拼成 hdc shell 命令。

验证范围及限制见[任务 3 报告](../docs/verification/task3-desktop-foundation.md)和[任务 4 报告](../docs/verification/task4-time-driven-replay.md)。

## 轨迹引擎

从 core/replay.js 导入 createReplay(route, settings, clock)，route 使用 compileRoute 的结果；clock 注入 monotonicMs 与 epochMs，生产环境可分别使用 performance.now() 与 Date.now()。先 start，再由调用方按 sampleIntervalMs 调用 next；引擎本身不启动定时器，每次只返回一个当前 Sample，序号从 1 开始。

pause 后 next 固定最后发出的坐标、朝向与 elapsedMs，更新 epochMs 且 speedMps 为零；resume 排除暂停时长，保留暂停前尚未采样的运行时间。首次采样前暂停时使用起点和零 elapsedMs。目标时长已到但终点未发出时，暂停仍固定最后样本，恢复后再发终点。重复 pause／resume 不改变进度，重复 start 或未启动采样会拒绝。

finished() 在唯一终点样本发出之后才返回 true，可使用“检查 finished → next”的调度方式。终点 elapsedMs 钳至目标时长、速度为零、位置回到起点；完成后 next／pause／resume 会拒绝。完成清理定位由后续会话控制器负责，再次运行需新建 Replay。
