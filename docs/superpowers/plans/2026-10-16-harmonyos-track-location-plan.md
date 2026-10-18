# HarmonyOS 操场轨迹定位工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan), or superpowers:subagent-driven-development if the user selects that execution method. Implement this plan task-by-task only after the user reviews the plan and selects an execution method. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为华为 Mate 80 Pro 规划并按条件实现操场定位轨迹模拟工具，先验证真机能力，再实现 USB 版本，优先争取脱机运行。

**Architecture:** 电脑端采用 TypeScript 本地服务与轻量界面，分离路线计算、会话状态、HDC 连接和定位执行。定位执行只能绑定真机已验证的入口；必要时使用 ArkTS 手机辅助程序。独立位置读取与日志提供验证证据。

**Tech Stack:** TypeScript、Node.js、Node 内置 `node:test`／`node:assert`、HTML／JavaScript、本地 JSON／JSONL、官方 HDC；必要时使用 ArkTS／ArkUI、DevEco Studio。

**Spec:** [已通过的设计规范](../specs/2026-10-16-harmonyos-track-location-design.md)。执行者必须先读规范和本计划。

状态：用户已选择本会话逐步执行。2026-10-18 接续：普通读取应用签名、安装授权和实际回调已验证；testhelper GPX 两固定点、短序列与有线停止恢复通过，USB G0–G2 通过。物理拔线约16秒无有效回调，原基线恢复存在未解释107米偏差，另一次新稳定基线USB启停复核通过；脱机仍未证实。任务2及任务3–6完成，任务5已合并main；任务6只完成会话／日志逻辑测试，未新增设备结论。任务7–9尚未开始，运动世界定位兼容性未测试。详见 [M0 结果](../../verification/m0-results.md)。

## Global Constraints

- 手机：华为 Mate 80 Pro；系统：HarmonyOS 7.0.0.109。
- 目标应用：从华为应用市场安装并直接打开的“运动世界”；M0 核实包名和版本。
- 首版运行方式：可以在运行期间持续通过 USB 连接电脑。
- 优先升级方向：最好能在断开 USB 后继续运行；脱机不是 USB 首版的完成条件。
- 首版围绕一条可配置的操场闭合路线完成闭环。
- 内部路线与发出样本统一为 WGS-84；采样原型默认每秒一次，最终频率服从已验证接口。
- 暂停不累计行进时间，固定最后坐标、速度为零；手动停止或完成全部圈数时清理定位。
- 固定点验证使用相距至少 100 米的两个点；统一坐标系后，独立读取误差不大于 5 米。
- G0、G1、G2 未通过，不执行完整产品任务 3–9；缺少授权或设备时报告待验证，不能假定支持或直接宣布不可行。
- 电脑界面移动、接口返回成功、模拟器成功都不能代替目标真机的独立读取结果。
- 本地控制服务只绑定 `127.0.0.1`；不把界面输入拼接为任意 shell 命令。
- 规划时目录只有文档且不是 Git 仓库；M0 后已创建本地首次提交。任务3–4曾在独立工作树实现并锁定桌面依赖；完整轨迹执行和控制服务尚未实现，远端由用户自行上传。2026-10-17 用户更新工作方式：后续任务在当前目录从 main 新建 codex/ 开发分支，不再单独创建隔离工作树，除非用户另有明确要求。

## Review Focus

1. RF1：连接两台手机或目标掉线时，必须操作显式选择的设备，不得自动改用另一台。任务 3、5、6 覆盖。
2. RF2：损坏 JSON、非法数值、错坐标系或异常路线连接应阻止启动并给出可修正错误。任务 3、7 覆盖。
3. RF3：系统时间调整、调度延迟、长时间暂停不应造成补跑、负距离或圈数失真。任务 4 覆盖。
4. RF4：USB 断开、进程退出、清理失败时，不得把未知手机状态显示为已恢复。任务 2、6、8 覆盖。
5. RF5：过期授权、重新连接后的旧样本或旧回调不得让新会话继续使用失效能力。任务 3、5、6、9 覆盖。

## 文件与职责

下表列出各任务的文件职责；M0 验证文件及任务3基础模块已生成，其余产品模块按任务继续实现，具体进度以上下文状态和任务复选框为准。

| 文件或目录 | 职责与所属任务 |
| --- | --- |
| `docs/verification/m0-environment.md` | 设备、工具、目标应用、接口和准入证据，任务 1 |
| `docs/verification/m0-report.json`、`m0-results.md` | 能力判定、真机验证与恢复结果，任务 2 |
| `docs/verification/location-write-entry-audit.md`、`official-location-capability-questions.md`、`prototype/permission-probe/` | 任务 1 追加只读权限与准入调查；不是定位注入或独立位置读取原型 |
| `docs/verification/huawei-support/` | 授权准入咨询正文、脱敏附件和提交说明；目前材料已准备但未提交 |
| `prototype/reader/entry/src/main/ets/location/LocationReader.ets` | 独立读取系统定位，任务 2 |
| `prototype/reader/entry/src/main/ets/pages/Index.ets`、`prototype/reader/entry/src/main/module.json5` | 读取界面与权限，任务 2 |
| `prototype/probe/README.md` | 已验证入口的实际调用、授权和停止步骤，任务 2 |
| `package.json`、`package-lock.json`、`desktop/tsconfig.json`、`.gitignore` | 桌面工具构建与依赖固定，任务 3；`.gitignore` 已在 M0 建立，须保留本机工具及设备报告忽略规则 |
| `desktop/src/core/types.ts`、`route.ts`、`geo.ts` | 数据约定、路线校验与距离计算，任务 3 |
| `desktop/src/hdc/process.ts`、`client.ts` | 明确参数的进程调用与目标设备选择，任务 3 |
| `desktop/src/probe/capabilities.ts` | 将 M0 报告转为可用能力，任务 3 |
| `desktop/src/core/replay.ts` | 配速、单调时间、暂停与圈数，任务 4 |
| `desktop/src/executor/contract.ts`、`verified-executor.ts`、`observer.ts` | 实际定位入口及独立读取通道，任务 5 |
| `desktop/scripts/verify-executor-device.mjs`、`docs/verification/task5-verified-executor.md`、任务5脱敏证据 | 受控真机复验及恢复限制，任务 5 |
| `desktop/src/core/session.ts`、`desktop/src/logging/journal.ts` | 会话状态、恢复与日志，任务 6 |
| `desktop/src/server.ts`、`desktop/src/index.ts`、`desktop/web/` | 本地 API、入口和控制界面，任务 7 |
| `desktop/tests/*.test.mjs`、`desktop/tests/fixtures/` | 桌面逻辑测试与合成数据，任务 3–7 |
| `docs/verification/usb-acceptance.md`、`sport-world-compatibility.md`、`docs/user-guide.md` | USB 验收、目标应用报告和使用说明，任务 8 |
| `mobile/entry/src/main/ets/replay/ReplayTypes.ets`、`ReplayController.ets`、`mobile/entry/src/main/ets/pages/Index.ets`、`mobile/entry/src/main/module.json5` | 有能力支持时实现手机数据约定、执行和停止入口，任务 9 |
| `docs/verification/standalone-report.md` | 脱机结论和限制，任务 9 |

未单列的原生工程描述和构建文件由与目标设备兼容的官方工程模板生成；必须在 M0 记录模板、SDK 和构建方式。不得用猜测的系统接口或注入命令填充适配层。

## 数据和跨任务接口

任务 2 的 `ProbeReport` JSON 使用以下固定字段：

- `status: 'passed' | 'blocked' | 'unsupported'`。
- `targetId: string | null`、`systemBuild: string | null`、`targetApp: { bundleName: string | null, version: string | null }`。
- `executionHost: 'desktop' | 'phone' | 'none'`。
- `g0: boolean`、`g1: boolean`、`g2: boolean`、`verifiedStandalone: boolean`。
- `expiresAtMs: number | null`、`evidencePaths: string[]`、`reason: string`。

只有 G0、G1、G2 均有证据通过时 `status` 才能为 `passed`。`expiresAtMs: null` 表示报告没有已知期限，不意味着没有签名或权限限制；限制写入 `reason` 和环境报告。

执行期修订：未从真机读取的身份字段使用 `null`，用户自述单独保留在环境报告。只有 `blocked`／`unsupported` 报告允许这些字段为空；`passed` 必须包含已核实且非空的设备标识、系统构建、应用包名和版本。G0–G2 的 `false` 表示尚未通过，试验是否执行须查证据记录。

任务 3 在 `types.ts` 定义：

- `ProbeReport`：严格对应上方 JSON 字段；`ObservedLocation` 也在此处导出。
- `GeoPoint = { latitude: number, longitude: number }`。
- `RouteConfig = { schemaVersion: 1, name: string, coordinateSystem: 'WGS-84', points: GeoPoint[] }`。
- `CompiledRoute = { points: GeoPoint[], segmentLengthsM: number[], cumulativeLengthsM: number[], lengthM: number }`。
- `RunSettings = { paceSecPerKm: number, laps: number, direction: 'forward' | 'reverse', sampleIntervalMs: number }`。
- `Sample = { sequence: number, latitude: number, longitude: number, elapsedMs: number, epochMs: number, speedMps: number, bearingDeg: number }`。
- `Clock = { monotonicMs(): number, epochMs(): number }`。
- `Capabilities = { canInject: boolean, executionHost: 'desktop' | 'phone' | 'none', verifiedStandalone: boolean, targetId: string, systemBuild: string, expiresAtMs: number | null, proofPath: string }`。
- `SessionState = 'disconnected' | 'unknown' | 'unsupported' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped' | 'recovery_required'`。

真实读取样本使用 `ObservedLocation = { latitude: number, longitude: number, epochMs: number, receivedAtMs: number, accuracyM: number | null, source: string | null, isMock: boolean | null }`。无法取得的来源或模拟标记使用 `null`，不能伪造为真实定位。

## 任务执行规则

任务 1–2 的主要验证是实际设备与证据审查，不为文档或环境读取编写空洞测试。任务 3–7 按“功能测试先失败 → 最小实现 → 对应测试通过”的顺序执行。

桌面测试用 `.test.mjs` 导入编译后的 `desktop/dist/`。任务 3 将 `package.json` 的 `type` 设为 `module`，创建脚本：`build` 为 `tsc -p desktop/tsconfig.json`，`test` 为 `node --test "desktop/tests/*.test.mjs"`，`start` 为 `node desktop/dist/index.js`。测试发现限定到计划的桌面测试目录，避免扫描本机忽略的 SDK 文件。`tsconfig` 使用严格检查、NodeNext 模块与解析、ES2022 目标、`rootDir: src`、`outDir: dist`，源码内本地模块导入使用编译后的 `.js` 扩展名。

每次先运行 `npm run build`，再运行该任务指定的测试。测试的初始失败须来自缺少对应行为，而不是环境或拼写错误。测试数据不能作为真机能力证明。

执行阶段若已有 Git 仓库，在每项任务验证通过后只提交该任务文件；原始真机日志与签名凭据保留在本机，提交报告使用适当的脱敏摘要和证据位置。

### Task 1：建立可复现的真机与接口调查记录（M0）

**Files:** Create `docs/verification/m0-environment.md`。

**Interfaces:** 消费用户手机和官方工具；产出目标设备标识、系统构建、应用包名／版本、工具版本、候选入口清单、授权条件和停止方法，供任务 2 使用。

- [x] 记录实际手机和运动世界版本，核实目标应用运行方式。已读取型号、完整软件版本、API 26，确认前台对应鸿蒙包及版本。
- [x] 查找已安装的官方 HDC；缺少工具时使用华为官方工具来源，记录版本及实际路径。只有需要原生工程时再配置相应 DevEco／SDK。现已从用户下载包提取 HDC，CRC 及华为 Authenticode 检查通过；整包官方 SHA-256 尚未比对，限制已记录。
- [x] 连接并授权调试后运行 `hdc list targets`，保存实际输出；没有目标或多目标未选定时停止设备操作。已明确选择唯一 USB 手机，未操作 UART 条目。
- [x] 对照官方文档和已安装 SDK 检查候选定位入口，逐项填写适用设备、调用主体、权限、签名、期限、清理方式；仅能读取定位或仅适用于模拟器的入口不能通过 G0。补查找到 testhelper，后续任务2已实测GPX与独立读取、有线恢复，USB范围G0通过。
- [x] 完成一次候选清单审查后提交结果。只有出现新设备、版本、授权或官方依据时才追加调查，避免无边界重复搜索。
- [x] 验证：报告中的每个“支持”结论都有对应来源或实际输出。没有完整准入证据时保持 `blocked` 或有充分依据的 `unsupported`，不开始任务 3。后续任务2已通过USB G1／G2；运动世界兼容性和脱机仍未验证。

### Task 2：完成固定点、连续移动及恢复试验（M0）

**Files:** Create 原生读取工程上述 3 个文件、`prototype/probe/README.md`、`docs/verification/m0-report.json`、`docs/verification/m0-results.md`。

**Interfaces:** 消费任务 1 已确认的入口；`LocationReader.start(onSample: (sample: ObservedLocation) => void): Promise<void>` 订阅真实系统定位，`stop(): void` 取消订阅；产出 `ProbeReport` 和实际读取证据。

读取工程在 `LocationReader.ets` 内声明与本计划字段一致的原生 `ObservedLocation` 类型，不依赖尚未创建的桌面 TypeScript 工程。

- [x] 若任务 1 没有可用入口，写明报告状态和缺失证据，结束本轮验证，不编写假注入程序。
- [x] 用兼容 SDK 的官方模板建立独立读取应用，声明并实际获得公开定位读取权限。按官方公开接口实现 `LocationReader`，在界面显示坐标和时间；来源字段不可用时保留 `null`。2026-10-17 已按官方样例结构及实际SDK适配，签名构建、真机安装和两项定位授权通过。
- [x] 在 DevEco 构建并运行读取应用，将 IDE 实际构建命令、SDK、签名方式和安装结果写入报告。不得在计划中虚构尚未核实的原生构建参数。2026-10-17 使用已安装IDE自带SDK／Node／Hvigor构建，用户自动调试签名；本机产品绑定default签名配置后SignHap、HDC安装和启动成功，实际参数见真机证据及读取说明。
- [x] 先采集设备正常位置基线，再通过已确认入口依次设置相距至少 100 米的两个测试点。保存设置结果和独立读取值，按设计的 5 米判据检查 G1。
- [x] 若存在官方明确的舍入或其他接口限制，先按规范记录适用判据再试验，不在结果失败后放宽判据。
- [x] 通过已验证的记录通道导出读取样本；可用通道可能是开发日志或读取应用本地导出，必须实际证明可取得数据。记录通道不能用预期输出代替真实读取。
- [x] 运行一段短的连续位置序列，执行停止及清理，重新获取带有新时间的正常位置；记录断线、进程退出后的实际行为，完成 G2。
- [x] 输出报告：G0–G2、恢复步骤、执行主体、可用采样频率、坐标约定、独立读取通道及授权期限。脱机未试验时 `verifiedStandalone` 必须为 `false`。
- [x] 验证：报告证据能重现 G1 和 G2；只有全部通过才能让任务 3–9 进入执行。某项尚待手机、授权或正常定位时使用 `blocked`，不把未试验写成失败或成功。

完成范围：USB M0。断线试验已执行并记录未通过，未把脱机作为首版前提；注入5米判据未调整。原基线断线恢复失败保留，另一次稳定基线USB启停复核通过。重启／锁屏后台和完整产品异常退出留待对应验收，不承诺已通过。

### Task 3：实现桌面基础、目标设备选择与路线校验（M1）

**Files:** Create `package.json`、`package-lock.json`、`desktop/tsconfig.json`、`desktop/src/core/types.ts`、`geo.ts`、`route.ts`、`desktop/src/hdc/process.ts`、`client.ts`、`desktop/src/probe/capabilities.ts`；Modify `.gitignore`（保留已有本机工具、私有日志和设备报告忽略规则）；Test `desktop/tests/hdc.test.mjs`、`route.test.mjs`、`capabilities.test.mjs`、`desktop/tests/fixtures/track.json`。

**Interfaces:** `parseRoute(input: unknown): RouteConfig`；`compileRoute(route: RouteConfig): CompiledRoute`；`distanceMeters(a: GeoPoint, b: GeoPoint): number`；`pointAtDistance(route: CompiledRoute, distanceM: number, direction: 'forward' | 'reverse'): GeoPoint & { bearingDeg: number }`；`HdcClient.listTargets(): Promise<string[]>`；`requireTarget(targetId: string): Promise<void>`；`capabilitiesFromReport(report: ProbeReport, context: { targetId: string, systemBuild: string, nowMs: number, proofPath: string }): Capabilities`。

`process.ts` 产出 `runProcess(executable: string, args: readonly string[], options: { signal?: AbortSignal }): Promise<{ exitCode: number, stdout: string, stderr: string }>`；`client.ts` 导出 `HdcClient`，构造参数为 `{ executable: string, run: typeof runProcess }`。`pointAtDistance` 按路线长度取模，整圈端点返回首点。

- [x] 初始化桌面构建和锁定依赖：安装 TypeScript 和 Node 类型声明并写入精确版本与锁文件；记录实际 Node／npm 版本，不覆盖 DevEco 自带运行时。
- [x] 写失败测试：`empty_targets_returns_empty` 断言 `[Empty]` 返回空列表；`explicit_target_required` 断言多设备时未指定或不匹配目标均被拒绝；`arguments_are_not_shell_text` 断言设备参数作为独立参数传递（RF1）。
- [x] 写失败测试：`invalid_route_rejected` 对损坏 JSON、NaN、Infinity、越界经纬度、非 WGS-84、少于 3 个不同点、零长度路线断言明确错误；`long_segment_rejected` 对大于 500 米的单段连接断言提示异常连接。500 米是本首版操场输入规则，不是平台限制（RF2）。
- [x] 写失败测试：`proof_required_for_capability` 对证据缺失或任意 G0–G2 未通过断言 `canInject === false`；`expired_or_wrong_device_proof_rejected` 对期限已过、设备或构建不匹配断言不可用（RF5）。
- [x] 在上述测试中固定关键断言：空设备输出使用 `assert.deepEqual(await client.listTargets(), [])`；将报告期限设为 `context.nowMs - 1` 后使用 `assert.equal(capabilitiesFromReport(report, context).canInject, false)`。
- [x] 运行 `npm run build` 后分别运行 `node --test desktop/tests/hdc.test.mjs`、`node --test desktop/tests/route.test.mjs`、`node --test desktop/tests/capabilities.test.mjs`，确认对应行为尚未实现。
- [x] 实现以上接口。HDC 使用进程参数数组及 `shell: false`；读取报告须检查证据文件存在。路线采用半径 `6371008.8` 米的球面距离与沿线插值，闭合路线只补一次首点，拒绝零长度段。
- [x] 加入数值测试：赤道上经度差 0.001 度的距离约 `111.1950802335` 米（允许 0.01 米计算误差）；往东朝向约 90 度；正反方向经过相同闭合路线，累计长度一致。
- [x] 重跑构建及以上测试，要求零失败。检查类型、返回值和文件名与后续任务一致；若已有 Git，提交本任务文件。

实际验收：Node 26.1.0／npm 11.13.0；TypeScript 7.0.2、@types/node 26.6.5；锁文件离线安装、严格构建及26个全量测试通过，详见[任务3报告](../../verification/task3-desktop-foundation.md)。该轮仅完成任务3；后续任务4已完成，见下方验收记录。

### Task 4：实现时间驱动的轨迹引擎（M1）

**Files:** Create `desktop/src/core/replay.ts`；Test `desktop/tests/replay.test.mjs`。

**Interfaces:** 消费任务 3 的路线和类型；`createReplay(route: CompiledRoute, settings: RunSettings, clock: Clock): Replay`。`Replay` 提供 `start(): void`、`pause(): void`、`resume(): void`、`next(): Sample`、`finished(): boolean`。

- [x] 写 `pace_and_elapsed_time`：配速 300 秒／公里时，30 秒累计行进约 100 米；当前位置对应沿线 100 米处。
- [x] 写 `pause_does_not_catch_up`：暂停 60 秒后累计距离和 `elapsedMs` 不变，采样时间更新、速度为零；继续后只累计实际运行时间。
- [x] 固定暂停断言 `assert.equal(paused.elapsedMs, beforePause.elapsedMs)`、`assert.equal(paused.speedMps, 0)`、`assert.ok(paused.epochMs > beforePause.epochMs)`；配速用例以独立期望距离 100 米和路线插值位置比较。
- [x] 写 `wall_clock_jump_does_not_move_runner` 和 `delayed_tick_uses_elapsed_time`：仅改变 `epochMs` 不改变位置；漏掉数次调度后按单调经过时间计算当前位置，不突发补发旧样本（RF3）。
- [x] 写 `lap_end_emitted_once`、`reverse_route_preserved`、`invalid_settings_rejected`：圈界连续、最后样本只输出一次、完成后不继续前进，拒绝非正配速／采样周期及非正整数圈数。
- [x] 运行 `npm run build`、`node --test desktop/tests/replay.test.mjs`，确认测试因对应行为缺失失败。
- [x] 实现接口：速度为 `1000 / paceSecPerKm`；使用注入的单调时间源累计运行时间并扣除暂停时间；完成距离为 `route.lengthM * laps`。
- [x] 重跑构建和本任务测试，要求零失败；若已有 Git，提交本任务文件。

实际验收（2026-10-17）：严格构建、14个新增轨迹测试及40个全量测试通过；暂停边界、终点轮询和非法调用语义见[任务4报告](../../verification/task4-time-driven-replay.md)。该轮未进行手机操作；后续任务5已完成，见下方验收记录。

### Task 5：接入已验证的定位执行与独立读取通道（M1）

**Files:** Create `desktop/src/executor/contract.ts`、`verified-executor.ts`、`observer.ts`；Modify `desktop/src/hdc/client.ts`；Test `desktop/tests/executor.test.mjs`、`desktop/tests/hdc.test.mjs`。

**Interfaces:** `LocationExecutor.prepare(context: { sessionId: string, targetId: string, mode: 'usb' | 'standalone' }): Promise<void>`；`send(sample: Sample): Promise<{ sessionId: string, sequence: number, accepted: boolean, errorCode: string | null }>`；`stop(): Promise<{ accepted: boolean, errorCode: string | null }>`；`PositionObserver.latest(): Promise<ObservedLocation | null>`。

`contract.ts` 导出上述 `LocationExecutor`、`PositionObserver`，并将 `send` 的返回值命名为 `SendReceipt`、`stop` 的返回值命名为 `StopReceipt`。`verified-executor.ts` 产出 `createVerifiedExecutor(capabilities: Capabilities, hdc: HdcClient, observer: PositionObserver): LocationExecutor`；`observer.ts` 产出 `createPositionObserver(hdc: HdcClient, targetId: string): PositionObserver`，其数据通道来自 M0 实测记录。

任务3接口核对补充：本任务在HdcClient新增显式目标命令调用，调用前重新requireTarget，始终保留独立的-t参数；由适配器限定固定命令和已校验的远端参数。任务3保留的通用runProcess不直接暴露给界面。runTarget的signal覆盖USB查询及命令，beforeRun同步守卫在最终查询后、实际派发前复查写入授权；stop不受授权过期阻止。

任务6生命周期补充：固定注入的执行器实例可在成功清理后重新prepare，新随机目录及序号重置；新实例经证据／系统核对后可主动stop，每次stop重新关闭残留。该调整仅有逻辑回归，任务5真机证据及摘要保留为当时实测版本。

- [x] 写失败测试 `unverified_executor_refuses_prepare`、`target_change_refused`、`expired_authorization_refused`、`injection_error_preserved`，断言未验证／不匹配／过期能力不能执行，实际错误码不被吞掉（RF1、RF5）。
- [x] 写失败测试 `accepted_does_not_mean_observed`：发送被接受但没有独立样本时，只返回执行结果，不生成读取结果或恢复成功记录。
- [x] 固定该用例断言 `assert.equal(receipt.accepted, true)` 与 `assert.equal(await observer.latest(), null)` 同时成立，防止将发送成功冒充观测成功。
- [x] 运行 `npm run build`、`node --test desktop/tests/executor.test.mjs`，确认失败后，严格按 M0 记录的真实入口和数据通道实现接口。
- [x] 如 M0 证实需要手机辅助程序，先按实际 SDK 和已取得的授权补充 `prototype/probe/README.md` 的文件、调用及签名安排，再接入该路径；未取得支持的系统接口不能靠类型断言或假实现替代。
- [x] 重跑构建和测试，随后用独立读取复验两个固定点及停止恢复。只有自动化测试通过而没有设备复验时，本任务仍未完成。
- [x] 若已有 Git，提交适配代码与脱敏说明；原始日志和签名材料留在本机。

实际验收（2026-10-17）：严格构建和60个全量测试通过；已验证单点GPX重复下发及两个相距133.434米的固定点。完整试验原基线恢复约51米偏差未通过，另一次新稳定基线下独立USB停止恢复通过；判据未放宽、失败保留，详见[任务5报告](../../verification/task5-verified-executor.md)。沿用已有独立读取HAP，无需新增手机定位执行程序。2026-10-18已按用户要求合并main；后续任务6完成情况如下。

### Task 6：实现会话状态、日志和恢复判定（M1）

**Files:** Create `desktop/src/core/session.ts`、`desktop/src/logging/journal.ts`；Test `desktop/tests/session.test.mjs`。

**Interfaces:** `SessionController.dispatch(command: SessionCommand): Promise<SessionSnapshot>`；`tick(): Promise<void>`；`snapshot(): SessionSnapshot`。

`session.ts` 导出 `SessionCommand = { type: 'configure', route: RouteConfig, settings: RunSettings, targetId: string, mode: 'usb' | 'standalone' } | { type: 'start' | 'pause' | 'resume' | 'stop' }` 和 `SessionSnapshot = { sessionId: string | null, state: SessionState, elapsedMs: number, distanceM: number, lap: number, expected: Sample | null, sent: { sample: Sample, receipt: SendReceipt } | null, observed: ObservedLocation | null, lastError: { code: string, message: string } | null }`。

`SessionController` 的构造参数为 `{ replayFactory: typeof createReplay, executor: LocationExecutor, observer: PositionObserver, journal: Journal, clock: Clock, hdc: HdcClient, capabilities: Capabilities }`。`journal.ts` 导出 `JournalEvent = { kind: string, epochMs: number, sessionId: string, targetId: string, data: Record<string, unknown> }`、`Journal = { append(event: JournalEvent): Promise<void> }` 和 `createJournal(path: string): Journal`。启动入口使用这些接口组装，不另造字段。

- [x] 写失败测试 `normal_controls_match_output`：开始／暂停／继续／自动完成依次产生正确样本；停止后不再发送。
- [x] 写失败测试 `disconnect_enters_recovery_required`、`cleanup_failure_never_marks_stopped`：拔线或清理失败时停止发送并保留待恢复状态，不能声称真实定位已恢复（RF4）。
- [x] 固定失败恢复断言 `assert.equal(controller.snapshot().state, 'recovery_required')`；`active_config_is_immutable` 断言运行时重新配置路线被拒绝，原会话使用的路线与设备不变。
- [x] 写失败测试 `stale_callback_ignored`：旧会话或旧连接的延迟结果不改变新会话；重连后未清理不能直接启动（RF5）。
- [x] 写失败测试 `fresh_independent_observation_required`：仅有停止请求成功、没有样本或只有清理前的缓存样本时，恢复结果保持未确认。恢复需结合 M0 验证的清理结果和清理后的正常定位观测；来源字段不可见时如实保留。
- [x] 运行 `npm run build`、`node --test desktop/tests/session.test.mjs`，确认失败后实现控制器；使用会话标识和连接代次过滤旧回调，停止期间使用内部 `stopping` 状态。
- [x] 日志分别保存预期、已提交和独立读取值，过滤账号密码、私钥和完整签名凭据。日志写入失败必须报告，不能伪造验证证据。
- [x] 重跑构建和本任务测试，要求零失败；若已有 Git，提交本任务文件。

实际验收（2026-10-18）：严格构建及85项全量测试通过，新增23项会话／日志及2项执行器生命周期测试。启动在主动关闭后采5个稳定新基线回调，35秒后不接受迟到样本；停止后45秒内须有3个新回调同时满足原基线50米、精度50米、远离尝试注入点100米和设备时钟5秒判据。断线、失败、超时均保留待恢复，重试沿用原基线；JSONL分开记录三类样本及恢复判据／结果。独立审查两项问题先失败后修复并闭环；本轮未操作手机，见[任务6报告](../../verification/task6-session-journal.md)。下一项任务7。

### Task 7：实现本地控制服务与界面（M1）

**Files:** Create `desktop/src/server.ts`、`desktop/src/index.ts`、`desktop/web/index.html`、`app.js`、`styles.css`；Test `desktop/tests/server.test.mjs`。

**Interfaces:** `createControlServer(controller: SessionController, hdc: HdcClient): Promise<{ url: string, close(): Promise<void> }>`，绑定 `127.0.0.1`。API 为 `GET /api/state`、`GET /api/targets`、`POST /api/session`；POST 使用任务 6 的指令数据，错误响应为 `{ code: string, message: string }`。

- [ ] 写失败测试：`bad_json_is_rejected` 返回 400 且会话不启动；`unsupported_capability_cannot_start` 返回明确能力错误；`unselected_target_cannot_start` 不隐式选择手机（RF1、RF2）。
- [ ] 固定损坏请求断言 `assert.equal(response.status, 400)`，并与请求前快照比较，断言 `state` 和 `sessionId` 均未改变。
- [ ] 写失败测试 `foreign_origin_refused`：拒绝来自其他网页来源的控制请求，不开放任意来源 CORS；只接受明确的 JSON 指令，不能把请求内容当 shell 文本。
- [ ] 运行 `npm run build`、`node --test desktop/tests/server.test.mjs`，确认失败后实现服务与入口。启动端口由系统分配并在本机输出 URL，避免与其他服务冲突。
- [ ] 启动入口使用 `HDC_PATH` 指定实际工具路径，`M0_REPORT_PATH` 默认指向项目的 `docs/verification/m0-report.json`；会话日志默认保存到 `local-data/sessions/` 并在 `.gitignore` 排除。缺少报告时呈现能力未确认，不能直接开始模拟。
- [ ] 实现设备选择、路线点编辑与形状预览、配速／圈数／方向、开始／暂停／继续／停止。状态区分别呈现预期、已提交、独立读取和恢复结果。
- [ ] 构建后运行 `npm start`。人工验证一个有效路线，以及损坏输入、权限未验证、设备掉线、清理失败等界面路径；错误必须保留输入并指出可修正项。
- [ ] 重跑本任务测试及全部 `npm test`，要求零失败；若已有 Git，提交本任务文件。

### Task 8：完成 USB 真机与运动世界兼容性验收（M1／M2）

**Files:** Create `docs/verification/usb-acceptance.md`、`docs/verification/sport-world-compatibility.md`、`docs/user-guide.md`。

**Interfaces:** 消费实际 USB 版本、M0 报告和真实会话日志；产出指定设备及目标应用版本的验收矩阵，不增加目标应用内部接口。

- [ ] 运行 `npm run build`、`npm test`，确认零失败后启动实际版本；重新检查目标设备与授权期限。
- [ ] 完成一条完整操场路线，验证圈数、配速、方向、暂停继续和自动停止；用实际读取数据核对路线，不能只看控制界面的数字。
- [ ] 实测手动停止、USB 意外断开、电脑进程退出及重新连接。记录手机实际定位、恢复方式，以及是否需要人工介入（RF4）。
- [ ] 在指定运动世界版本中观察定位读取和轨迹生成，由用户操作目标应用并检查最终记录。将“未读取”“读取但不成轨迹”“有轨迹但记录无效”“记录有效”分别报告；未知记为未验证。
- [ ] 在使用说明中写清设备／工具版本、启动、路线配置、暂停／停止、恢复步骤、权限期限，以及该版本必须维持 USB 的条件。
- [ ] 验收结果不满足某项时定位到前述责任任务修复或记录限制；不得把应用兼容失败改写为成功。若已有 Git，提交脱敏报告和使用说明。

### Task 9：评估并实现有条件的脱机升级（M3）

**Files:** Create `docs/verification/standalone-report.md`；有可用手机执行能力时 Create `mobile/entry/src/main/ets/replay/ReplayTypes.ets`、`mobile/entry/src/main/ets/replay/ReplayController.ets`、`mobile/entry/src/main/ets/pages/Index.ets`、`mobile/entry/src/main/module.json5` 及官方工程模板文件；Modify `desktop/src/executor/verified-executor.ts`、`desktop/tests/executor.test.mjs`、`docs/user-guide.md`。

**Interfaces:** 手机 `ReplayController.start(route: RouteConfig, settings: RunSettings): Promise<void>`、`pause(): void`、`resume(): void`、`stop(): Promise<void>`；与桌面轨迹时间语义一致。只有完成本任务真机验收后才能把报告的 `verifiedStandalone` 置为 `true`。

`ReplayTypes.ets` 用 ArkTS 定义与路线及运行配置字段一致的 `RouteConfig`、`RunSettings`；通过同一合成路线文件核对序列化结果，不直接导入桌面 `.ts` 文件。

- [ ] 根据 M0／M2 证据核实手机是否能独立执行、是否仅需 USB 启动、授权／签名有效期和后台运行条件。
- [ ] 没有可取得的手机执行能力时，完成明确的不可用／待支持报告并保留 USB 版本；不能用电脑界面离线动画代替脱机能力。
- [ ] 有可用路径时，先为手机引擎建立配速 300 秒／公里、30 秒约 100 米、暂停 60 秒不补跑、反向和圈界用例，再实现接口。采用实际 SDK 的测试工具，记录真实构建／测试命令和输出，不预设桌面 TypeScript 能直接在 ArkTS 运行。
- [ ] 提供手机端可用的停止与恢复入口，按官方要求配置已验证的后台执行能力；接入桌面启动或路线传输时进行实际设备确认。
- [ ] 真机依次测试拔线、锁屏、切换后台、手机端停止、电脑退出、重启后的残留行为，并记录授权或证书到期时的结果（RF5）。
- [ ] 重跑受影响桌面测试，复验运动世界兼容性。报告明确支持的是“USB 启动后可拔线”还是“完全手机独立”；未通过的方式不标为支持。
- [ ] 更新能力报告和使用说明；若已有 Git，提交代码与脱敏报告。

## 需求与任务覆盖

| 规范要求 | 实施任务 | 必须保存的证据 |
| --- | --- | --- |
| R1 真机能力 | 1、2、3、5 | 版本／入口／权限、设备试验及能力报告 |
| R2 系统定位影响独立应用 | 2、5、8 | 独立读取记录与输入坐标比较 |
| R3 操场轨迹与配速 | 3、4、8 | 路线和时间测试、真机路线 |
| R4 圈数与控制 | 4、6、7、8 | 计算与状态测试、实际操作记录 |
| R5 USB 首版 | 1、5、6、7、8 | 有线会话和异常恢复验收 |
| R6 脱机优先升级 | 9 | 拔线／后台／停止／期限报告，或明确不支持结论 |
| R7 运动世界兼容性 | 8、9 | 指定版本的分层兼容性报告 |
| R8 故障与恢复诊断 | 2、5、6、7、8、9 | 错误、独立恢复观测、重连及日志 |

规范中的路线输入、时间语义、模块边界、最小界面、数据约定和版本限制分别由任务 3–7 实现；G0–G2 与进入完整开发的门槛由任务 1–2 实施。

## 验收与交接

- 本次规划交付：已通过的规范、本实施计划、公开技术调查；三个文件相互可追溯。
- 后续软件交付：按实际通过的任务和真机结果判定，不能由计划文件存在推定完成。
- 建议执行方式：Native，由同一执行者先完成任务 1–2，再决定是否开展后续任务；目标手机与定位入口是顺序依赖，当前不适合先拆开并行实现。
- 如用户选择子代理方式，必须先确认该执行方式，再按对应技能安排；本次规划没有派发子代理。
- 用户审阅本计划并选择执行方式后，才进入实施。缺少目标手机或必要授权时，优先交付 M0 的实际调查结果，不反复运行无新证据的搜索。

编写时只读检查到本机 Node.js `v26.1.0`、npm `11.13.0`，没有安装产品依赖或运行上述软件测试。桌面测试运行方式依据 [Node 官方测试文档](https://nodejs.org/api/test.html)；模块配置依据 [TypeScript 官方文档](https://www.typescriptlang.org/tsconfig/module.html)。原生接口和权限依据随设计规范和[调查记录](../../research/2026-10-16-harmonyos-location-feasibility.md)保留，实际工具版本与兼容性在任务 1–2 重新核实。
