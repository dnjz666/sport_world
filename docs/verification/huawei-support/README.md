# 官方能力咨询提交材料

更新：已实测真机 testhelper 1.0.1 启用与关闭成功，见 [M0 当前结果](../m0-results.md)。以下为此前的咨询准备材料；不再要求先申请系统模拟权限才能继续这条工具路线。没有因用户粘贴答复而推定本材料已提交。压缩包保留原内容及校验和，不将历史附件覆盖为新证据。

日期：2026-10-16。状态：**材料已准备，尚未提交咨询，尚未申请或取得权限／签名**。

用户已确认有实名认证的华为开发者账号。当前缺少的是 MOCK_LOCATION 的实际可申请性与系统接口身份条件，不能通过通用签名说明直接推定权限可用。

## 提交步骤

1. 打开[华为官方在线提单入口](https://developer.huawei.com/consumer/cn/support/feedback/)，由账号本人登录。
2. 按页面实际提供的类别选择 HarmonyOS 应用开发、权限或签名相关咨询；咨询正文使用 [request.md](request.md)。若要求已注册应用信息，填写本人实际 APP ID／包名；运动世界是第三方测试对象，不能填写为本人开发的应用。
3. 附加同目录生成的 `huawei-location-capability-consultation-2026-10-16.zip`，核对正文及附件后，由账号本人提交。
4. 保存工单号和官方答复。本项目只有在入口、身份和权限条件得到明确支持后，才继续定位写入及独立读取试验。

如果页面暂时无法提单，可以使用[官方开发者支持首页](https://developer.huawei.com/consumer/cn/support/)查找当前技术支持入口。这里不虚构已进入的表单、具体必填字段或已提交状态。

## 已准备的附件

- `request.md`：可直接使用的完整咨询正文。
- `device-summary.json`：脱敏设备、工具与目标应用信息。
- `permission-definition.json`：真机返回的 MOCK_LOCATION 定义。
- `diagnostic-summary.json`：HDC 清单与原生探针的实际结果和限制。
- `source-references.md`：官方资料及适用范围。
- `SHA256SUMS.txt`：附件逐文件校验值。

本材料是能力咨询，不冒充已创建的 AGC 应用、权限申请或审批结果。未注册新的 AGC 应用，未签署申请，未向任何第三方发送内容。

## 本轮公开资料核对

华为[自动签名指南](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-signing-auto)说明，关联应用可配置 ACL，并在 AGC 互动中心查看申请状态；26.0.0 版本提供 Enable ACL Permissions 配置流程。这仍不证明 MOCK_LOCATION 对本项目开放。

本轮未成功取得新版受限权限清单正文。公开页面请求返回前端加载壳；CMS 元数据返回空 parts；按公开前端请求尝试解析该别名时返回 document not found；官方旧链接映射未给出替代 URL。不能据此宣称权限清单为空、内容需要登录、权限不存在或不开放。

浏览器操作会话在重置后连续两次超时，无法读取本人登录后的权限列表或完成表单操作。需要账号本人在官方页面核实及提交；未访问浏览器 Cookie、证书私钥或账号凭据。
