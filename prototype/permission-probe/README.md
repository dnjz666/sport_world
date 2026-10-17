# 只读自身权限检查原型

用途：M0 中检查 HDC 启动的进程是否已有定位相关权限。源码只调用公开 `OH_AT_CheckSelfPermission`、`getuid` 和输出函数，没有定位写入、权限授予或运动世界操作。

当前结果：**编译成功，目标手机拒绝执行，未得到自身权限 API 返回值**。不能将此原型写成已运行成功，或把执行拒绝解释为该 API 返回了“无权限”。

## 已执行的构建

工作目录为 `D:\code\sport_world`。使用用户提供工具包中的 OHOS clang 15.0.4、AArch64 sysroot、compiler-rt 与 libunwind；提取范围与摘要记录在本机 `tools/ndk-probe/extraction-manifest.json`。主机编译器、链接器和两个依赖 DLL 的华为 Authenticode 均为 Valid。

以下编译与链接命令已分别成功执行：

```powershell
& '.\tools\ndk-probe\llvm\bin\clang.exe' --target=aarch64-linux-ohos --sysroot=tools/ndk-probe/sysroot -fPIE -O2 -Wall -Wextra -Werror -c prototype/permission-probe/check.c -o tools/probe-bin/permission-check.o
& '.\tools\ndk-probe\llvm\bin\clang.exe' --target=aarch64-linux-ohos --sysroot=tools/ndk-probe/sysroot --rtlib=compiler-rt -fuse-ld=lld -pie tools/probe-bin/permission-check.o -lability_access_control -o tools/probe-bin/permission-check
```

产物为 14,272 字节的 AArch64 ELF PIE，SHA-256：

`2a25e91a3e9dc25861be9b1e2a35717954d19f913c7f075db404f894b1b82be0`

SDK 中该检查 API 标注自 API 12 提供。当前构建使用 API 24 SDK；这不等于已经在 API 26 手机上成功调用。

## 真机结果与限制

- 通过显式选中的 USB 目标传输，手机端 SHA-256 与本机产物一致。
- HDC 按实际传输行为保留了 `probe-bin` 目录层级。已核实真实文件路径后，执行目标为 `/data/local/tmp/sportworld-permission-2a25e91a3e9d/probe-bin/permission-check`。
- 文件为普通文件，所有者 `shell:shell`，权限 `-rwx------`，安全上下文 `u:object_r:data_local_tmp:s0`。
- 手机返回 `Permission denied`。未确认具体拒绝机制；读取 `getenforce` 也被拒绝，因此没有据此断言 SELinux 模式或某一特定拦截机制。
- 没有得到 `dumpGranted`、`mockLocationGranted`、`preciseLocationGranted` 或 `approximateLocationGranted` 的运行值，审计记录中 `selfPermissionResult` 为 `null`。
- 已按摘要核对后删除本次上传的单个文件，并用非递归 `rmdir` 移除两个空目录；最后确认临时目录已不存在。

实际权限定义与 HDC 服务权限清单来自系统自带 `atm dump`，独立于这个未能运行的原型。详见[审计结果](../../docs/verification/location-write-entry-audit.md)及[清理证据](../../docs/verification/evidence/2026-10-16-permission-probe-cleanup.json)。
