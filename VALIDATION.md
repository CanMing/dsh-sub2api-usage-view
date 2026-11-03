# 验证记录

目标环境：Windows，Node.js 24.21.0（DSH 桌面版自带运行时），DSH 0.2.2-rc.1。

## 已验证

- `npm run build`：生成 DSH classic ModuleLoader 客户端。
- `npm run check`：主机、用量服务、路由和客户端语法检查通过。
- `npm test`：43 项通过，0 失败。
- 使用当前 DSH 的实际兼容性校验器检查 manifest，结果 accepted。
- 真实 Cordis schema/Loader 激活用量主机插件，配置引用、凭据解析和路由释放正常。
- 在运行中的 DSH 0.2.2-rc.1 桌面版安装后，宿主路由 `/api/dsh-sub2api-usage-view/usage` 与 `/accounts` 立即返回预期的配置提示，未配置服务地址时不发起任何上游请求。
- 设置保存测试执行已安装的 DSH 0.2.2-rc.1 SettingsFormModel 代码，验证配置修订冲突、同时修改引用与密钥、密钥写入失败后重试。Node 无法直接加载浏览器入口时，从已安装包中提取对应源码区域执行；可观察存储和 RPC 边界为测试 fixture。
- 对比 0.2.1-rc.5 与 0.2.2-rc.1 的官方类型声明：`conversation.composer.dock`、`plugins.item`、`configForms`、`ctx.slots`、`ctx.remote.credentials`、`webServer.register`/`getOrigin` 均为兼容或仅新增成员，本插件使用的签名未变。
- 未填写服务地址时返回配置提示，不会发送外部请求；公开默认配置不包含部署地址。
- 自动模式模拟验证只调用账号详情 GET；手动刷新调用 `/usage?source=active`，不发送 `force=true` 或 quota reset。Codex 上游探测完全由 sub2api 决定，测试使用模拟响应。

## 覆盖边界

未使用真实管理员密钥，未查询或修改用户订阅账号，未消耗订阅模型额度。尚未在本机用真实 sub2api 账号完成输入框下方余量显示的人工验收；宿主侧激活与接口响应已验证，浏览器内的槽位渲染由自动化测试覆盖组件与生命周期，未做像素级截图验收。

真实账号验收步骤：安装发布包，在插件设置中保存管理员 API Key，读取并选择账号后保存；正常使用该账号，让 sub2api 采集用量，再确认输入框下方的余量和重置时间与后台一致。
