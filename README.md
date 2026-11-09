# dsh-sub2api-usage-view

在 DeepSeek Harness 会话输入框下方显示 **sub2api 订阅账号的 5 小时、7 天剩余额度和重置倒计时**。

```text
5 小时 剩余 75% · 02:43:16 重置     7 天 剩余 37% · 2天 03:12:08 重置   ↻
```

适用于 **DSH 桌面版 0.2.2-rc.1**，支持 sub2api 中的 Codex / OpenAI OAuth、Claude / Anthropic OAuth 与 setup-token 订阅账号。百分比示例仅用于说明界面。

## 安装

在 DSH「插件」页安装 GitHub 仓库：

```text
https://github.com/CanMing/dsh-sub2api-usage-view
```

也可从 [Releases](https://github.com/CanMing/dsh-sub2api-usage-view/releases) 下载预构建 `dsh-sub2api-usage-view-0.1.2.tgz`，将其绝对路径填入安装框。包内已包含客户端构建产物，无需在安装时编译。

CLI 安装方式：

```sh
dsh plugin --profile desktop add /absolute/path/dsh-sub2api-usage-view-0.1.2.tgz
```

按 DSH 提示重新加载或重启，然后在插件配置中打开「Sub2API 用量」。

## 配置

1. 服务地址默认为空，必须填写你自己的 sub2api 服务地址；例如 `https://sub2api.example.com`，也支持部署前缀。
2. 在 sub2api 管理后台创建或查看 **管理员 API Key**，在插件的密钥字段中填写并保存。这里需要管理 API 的密钥，普通聊天转发 Key 无法读取账号用量。
3. 保存密钥后，读取账号列表并选择要显示的订阅账号；也可直接填写后台账号的数字 ID，再保存。
4. 回到会话，即可在输入框下方查看余量和倒计时。点刷新按钮可重新读取快照。

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| 启用 | 开 | 显示用量并允许读取 |
| 服务地址 | 空（必填） | 用户自己的 sub2api 服务根地址 |
| 管理员凭据引用 | `SUB2API_ADMIN_KEY` | 密钥在 DSH 凭据服务中的名称 |
| 账号 ID | 空 | 指定一个订阅账号，避免把不同账号额度混合 |
| 刷新间隔 | 60 秒 | 可配置 30–3600 秒 |
| 用量源 | 自动快照 | 读取后台已保存的供应商用量 |

密钥写入 DSH 凭据域；插件普通配置只保存凭据引用。留空保存会保留已有密钥。插件不要求提供上游 OAuth Token 或订阅账号密码。

## 显示与刷新规则

- 使用 DSH 官方 `conversation.composer.dock` 槽位，位于输入框下方，与会话统计同一区域；不修改 DSH 程序文件。
- **剩余百分比 = 100 − 后台采集的已用百分比**；上下限为 0–100%。不把多个账号的额度相加。
- 重置时间按绝对时间戳计算，每秒更新倒计时；倒计时不触发上游请求。
- 多个会话共用查询缓存；页面隐藏或没有挂载用量栏时停止客户端轮询。手动刷新有 10 秒最小间隔。
- 未配置密钥或账号时显示配置提示。后台未采集某个窗口时显示未知，不把它当作 100% 剩余。
- 网络失败保留同一账号的最近成功数据并标记过期；切换账号、服务地址或密钥时不会沿用旧账号数据。
- 已经过重置时间的快照显示等待刷新，不擅自重置为满额。旧采集时间会在详情中显示。

默认 **自动快照** 直接读取账号 `extra` 中的已采集数据。先通过 sub2api 使用该账号发起正常聊天请求，sub2api 记录了上游响应头之后才会有数据。安装插件或点击刷新不会凭空生成新采样。账户不活跃时，后台快照可能较旧。

高级用量源：

- `passive`：调用 sub2api 的 Claude 被动用量接口，只适用于 Anthropic 账号。部分 sub2api 版本会根据会话状态估算窗口用量。
- `active`：调用 sub2api 的主动用量接口。Codex 在部分版本中可能发起合成模型请求来探测用量；仅在需要并接受此行为时选择。插件不发送 `force=true`。

这是订阅提供商的限制窗口，与 sub2api 用户余额、API Key 预算和消费金额不同。

## 数据与访问

管理员密钥由本机宿主发送到配置的 sub2api 服务，浏览器只接收账号显示名称、窗口余量与时间，不接收原始账号 `credentials`、OAuth Token 或管理员密钥。上游请求拒绝重定向，避免把管理密钥带到其他地址。查询有超时、响应大小限制和并发去重。

本机桥接路由只允许本机回环地址与同源访问，不开放跨域读取；插件面向本机桌面/Web GUI，远程浏览器访问不在此版本支持范围。

## 开发

需要 Node.js 24（或支持项目测试参数的较新 Node.js）。

```sh
npm ci
npm run build
npm run check
npm test
npm pack
```

客户端以普通 ESM 源码维护，构建为 DSH `window.__ModuleLoader__.load` 模块。预构建产物提交到仓库，支持 GitHub 安装。插件严格声明兼容 DSH `0.2.2-rc.1`，其他版本需要重新验证。

测试使用模拟 sub2api 响应，覆盖百分比/时间单位、Codex 与 Claude 快照、未知数据、过期数据、请求缓存、密钥切换、同源访问限制、官方槽位、轮询清理和客户端构建。没有使用真实管理员密钥或消耗订阅额度。真实服务验收需要安装后在本机设置管理员 Key 和账号。

## 接口依据

本插件根据 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 的公开实现适配：

- [账号管理接口](https://github.com/Wei-Shaw/sub2api/blob/4a4a83ee5ec86b19d3a2dd9b6471de5128963bec/backend/internal/handler/admin/account_handler.go)
- [用量窗口和快照字段](https://github.com/Wei-Shaw/sub2api/blob/4a4a83ee5ec86b19d3a2dd9b6471de5128963bec/backend/internal/service/account_usage_service.go)
- [管理员 API Key 认证](https://github.com/Wei-Shaw/sub2api/blob/4a4a83ee5ec86b19d3a2dd9b6471de5128963bec/backend/internal/server/middleware/admin_auth.go)

第三方独立插件，与 DeepSeek、OpenAI、Anthropic 和 Sub2API 官方无隶属关系。MIT License。
