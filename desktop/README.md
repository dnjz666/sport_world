# 桌面基础库（任务 3）

当前提供 TypeScript 基础模块，尚无控制界面、轨迹时钟或定位写入适配器。

## 构建与测试

本轮环境：Node 26.1.0、npm 11.13.0；精确锁定 TypeScript 7.0.2、@types/node 26.6.5，传递依赖由 package-lock.json 固定。源码使用 NodeNext／ES2022 严格类型检查，测试导入 desktop/dist 的编译产物。

在仓库根目录运行：

```powershell
npm ci
npm run build
npm test
```

已从 npm 生成的锁文件离线重新安装，并实际通过全部 26 个测试。node_modules 和 dist 均不提交；测试不连接手机。npm start 的服务入口在任务 7 实现后才可用。

若系统浏览器／PowerShell 能连接 npm，而 npm 超时，可核对 npm 是否沿用系统已有代理。本轮只为安装进程设置代理，未改全局配置、关闭 TLS 校验或切换镜像；常规环境无需此调整。

## 模块

| 文件 | 行为 |
| --- | --- |
| [types.ts](src/core/types.ts) | 与已批准计划一致的路线、能力、采样、时钟及会话类型 |
| [process.ts](src/hdc/process.ts) | 参数数组、shell:false、隐藏 Windows 子窗口；保留两条输出流及退出码，支持 AbortSignal |
| [client.ts](src/hdc/client.ts) | 固定已验证 HDC 服务 127.0.0.1:8710，仅返回 Connected USB；requireTarget 必须明确选择且每次重新查询，掉线不换设备 |
| [route.ts](src/core/route.ts) | JSON／对象解析，WGS-84、有限范围、三个不同点、零长度及 500 米连接检查；闭合一次、累计长度、正反向沿线位置 |
| [geo.ts](src/core/geo.ts) | 半径 6371008.8 米的球面距离、短弧插值和当前位置朝向 |
| [capabilities.ts](src/probe/capabilities.ts) | 对照保存的报告、目标／系统、G0–G2、期限及实际证据文件，条件缺失则禁用能力 |

## 输入约定

路线格式见[合成方形样例](tests/fixtures/track.json)。样例位于赤道附近，纯属单元测试数据，不是实际操场或真机定位证据。首点可省略重复闭合点，也可在末尾写一次；连续重复点、零长度段及闭合连接超过 500 米均拒绝。500 米是本产品的操场输入规则。

parseRoute 接受 JSON 文本或对象；compileRoute 也自行校验并复制数据。pointAtDistance 接受非负有限累计距离，按总长度取模，正反向走同一闭合路线；整圈回到首点，拐点朝向下一段。

capabilitiesFromReport 的 proofPath 指向保存的 ProbeReport JSON，报告内容须与传入对象一致。evidencePaths 中的相对路径从当前仓库工作目录解析，绝对路径可直接使用。外部目录启动时须设定正确工作目录或提供绝对证据路径。该检查用于防止误用缺失、过期或错误设备的报告，不把本地 JSON 当作签名授权机制；实际连接仍通过 HdcClient 独立核实。

Task 3 只提供 HDC 设备查询和通用进程边界；任务 5 会在已验证适配器中补充显式目标命令调用、固定远端命令和参数校验。不能将任意界面文本拼成 hdc shell 命令。

验证范围及限制见[任务 3 报告](../docs/verification/task3-desktop-foundation.md)。
