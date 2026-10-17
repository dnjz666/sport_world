# testhelper 真机入口

2026-10-17 在 Mate 80 Pro／HarmonyOS 7.0.0.109（API 26）实测：testhelper 1.0.1 可启用模拟、解析 GPX 轨迹、提供系统测试坐标并关闭；独立普通读取应用收到两个固定点与连续位置，有线停止恢复通过。见 [M0 结果](../../docs/verification/m0-results.md)及[真机证据](../../docs/verification/evidence/2026-10-17-reader-device-probe.json)。运动世界兼容性未测试。

## 已实测命令

```text
hdc -s 127.0.0.1:8710 -t <已核实USB目标> shell testhelper enable-location-mock
hdc -s 127.0.0.1:8710 -t <已核实USB目标> file send <本机文件名.gpx> /data/local/tmp/<本次专属目录>
hdc -s 127.0.0.1:8710 -t <已核实USB目标> shell testhelper set-mocked-locations /data/local/tmp/<本次专属目录>/<文件名.gpx> 1
hdc -s 127.0.0.1:8710 -t <已核实USB目标> shell testhelper disable-location-mock
```

本轮实际先推送并核对 GPX 摘要，再启用及设置；上方为命令形式，不是可直接复制的设备 ID 或完整自动恢复脚本。真实成功文本为 Enable location mock successfully.／Set mocked locations successfully.／Disable location mock successfully.；同时检查 HDC 退出码和工具结果，任何写入都须 finally 尝试关闭。

本机 HDC 路径为 `D:\code\sport_world\tools\hdc\hdc.exe`，服务为 127.0.0.1:8710。目标 ID 从忽略的本机 m0-report.json 读取，并先核实 list targets -v 中该目标为 USB Connected；不省略 -t，不选 UART，不在掉线后换手机。

## 输入和读取约定

本轮使用 WGS-84、标准 GPX 1.1 的 trk／trkseg／trkpt，1 秒间隔，单次 16／24／120 点。GPX 推送后逐项核对实际路径和 SHA-256；相对源路径可能保留目录层级，使用明确源目录和文件名，不假定推送后的路径。

OpenHarmony 官方[testhelper 指导](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/application-test/testhelper-guidelines.md)记载 `/data/local/tmp` 下无 `..` 的绝对 .gpx 路径、最多 1000 点、整数间隔 1–3600 秒。文档边界未全部在商用手机上测试，不能把合法小输入通过写成所有边界通过。

独立读取通过公开 geoLocationManager locationChange 与 M0Reader HiLog JSON 取证。两个点相距 133.434 米，13／11 样本误差均远小于 5 米；短路线19个位置跨18秒，set命令退出后仍更新。无需普通读取应用取得系统模拟权限；调用主体为电脑经 HDC 启动的系统工具。

## 停止、断线与清理

停止须执行 disable-location-mock 并继续独立读取新正常坐标。首次停止和另一次稳定基线下的 USB 复核均通过。取消读取订阅、退出读取页和删除 GPX 都不能代替关闭模拟。

用户实际拔线16.371秒，本轮没有取回空档内有效回调；原基线恢复另有未解释107米偏差，保留为未通过。拔线继续运行未证实，当前要求保持USB；断线时状态未知，重连后先关闭再核对正常位置。没有手机端独立启停入口证明，verifiedStandalone=false。

本轮26个GPX／UI临时文件在逐一核对摘要后删除，仅删除本次空专属目录，确认其不存在；本机原始证据保留。后续测试另建并跟踪专属路径，不递归清理公共临时目录，不隐藏系统模拟标记。
