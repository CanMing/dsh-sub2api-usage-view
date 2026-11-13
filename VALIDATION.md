# 验证记录

目标环境：Windows，Node.js 24.22.2（DSH 桌面版自带运行时），DSH 0.2.2-rc.3。

## 已验证

- `npm run build`：生成 DSH classic ModuleLoader 客户端。
- `npm run check`：主机、用量服务、路由和客户端语法检查通过。
- `npm test`：43 项通过，0 失败（`@deepseek-ai/dsh-client-ui-primitives` 为 0.2.2-rc.3）。
- 使用当前 DSH 的实际兼容性校验器检查 manifest，结果 accepted。
- 真实 Cordis schema/Loader 激活用量主机插件，配置引用、凭据解析和路由释放正常。
- 设置保存测试执行已安装的 DSH 0.2.2-rc.3 SettingsFormModel 代码，验证配置修订冲突、同时修改引用与密钥、密钥写入失败后重试。Node 无法直接加载浏览器入口时，从已安装包中提取对应源码区域执行；可观察存储和 RPC 边界为测试 fixture。
- 对比 0.2.2-rc.1 与 0.2.2-rc.3 的使用面：`conversation.composer.dock`、`plugins.item`、`configForms`、`ctx.slots`、`ctx.remote.credentials`、`webServer.register`/`getOrigin` 均未出现破坏性变更，本插件代码无需改动。
- 未填写服务地址时返回配置提示，不会发送外部请求；公开默认配置不包含部署地址。
- 自动模式模拟验证只调用账号详情 GET；手动刷新调用 `/usage?source=active`，不发送 `force=true` 或 quota reset。Codex 上游探测完全由 sub2api 决定，测试使用模拟响应。

## 覆盖边界

本次只做依赖与版本对齐验证，未在运行中的桌面实例上重装发布包，也未发起 `source=active` 查询、quota reset 或账号修改。UI 槽位、组件输出及生命周期有自动化验证；本记录不声称已进行 Electron 人工点击或像素截图验收。

真实账号验收步骤：安装发布包，在插件设置中保存管理员 API Key，读取并选择账号后保存；正常使用该账号，让 sub2api 采集用量，再确认输入框下方的余量和重置时间与后台一致。
