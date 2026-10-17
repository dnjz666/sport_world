# 官方资料和适用范围

- [华为自动签名](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-signing-auto)：已读取当前说明。关联注册应用可配置 ACL、提交申请并查看状态；提供通用 Profile 签名流程。它没有构成本项目获得 MOCK_LOCATION 或系统应用身份的证明。
- [华为受限开放权限](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/restricted-permissions)：由官方签名指南链接得出；本轮未取得有效正文，具体权限清单尚未核实。
- [申请使用受限权限](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/declare-permissions-in-acl)：由同一签名指南链接得出；本轮未取得有效正文，不能虚构具体准入结果。
- [华为在线提单入口](https://developer.huawei.com/consumer/cn/support/feedback/)：由华为开发者文档页的“在线提单”链接取得；登录后的表单未读取、未填写、未提交。
- [OpenHarmony 定位服务实现](https://github.com/openharmony/base_location/blob/4c5dca7cf9faeae4da0ba833945770600129e2dc/services/location_locator/locator/source/locator_ability.cpp)：包含上游模拟定位调用链、身份与权限检查、USB／开发者模式相关条件；不是本机商用二进制逐项行为保证。
- [OpenHarmony 定位权限实现](https://github.com/openharmony/base_location/blob/4c5dca7cf9faeae4da0ba833945770600129e2dc/frameworks/location_common/common/source/permission_manager.cpp)：说明上游如何区分调用身份和验证模拟定位权限。

真机权限定义、USB 连接和应用版本来自本机已授权的只读调试结果；附件仅保留完成能力咨询所需的脱敏字段。
