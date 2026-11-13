# dsh-sub2api-usage-view

在 DeepSeek Harness 会话输入框下方显示 **sub2api 订阅账号的 5 小时、7 天剩余额度和重置倒计时**。

```text
5 小时 剩余 75% · 02:43:16 重置     7 天 剩余 37% · 2天 03:12:08 重置   ↻
```

适用于 **DSH 桌面版 0.2.2-rc.3**（已在 rc.3 验证，rc.1 起可安装），支持 sub2api 中的 Codex / OpenAI OAuth、Claude / Anthropic OAuth 与 setup-token 订阅账号。百分比示例仅用于说明界面。

## 安装

在 DSH「插件」页安装 GitHub 仓库：

```text
https://github.com/CanMing/dsh-sub2api-usage-view
```

也可从 [Releases](https://github.com/CanMing/dsh-sub2api-usage-view/releases) 下载预构建 `dsh-sub2api-usage-view-0.2.1.tgz`，将其绝对路径填入安装框。包内已包含客户端构建产物，无需在安装时编译。

CLI 安装方式：

```sh
dsh plugin --profile desktop add /absolute/path/dsh-sub2api-usage-view-0.2.1.tgz
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
| 用量源 | 自动 | 定时读取后台快照；点击输入框下方刷新按钮主动查询实际用量 |

密钥写入 DSH 凭据域；插件普通配置只保存凭据引用。留空保存会保留已有密钥。插件不要求提供上游 OAuth Token 或订阅账号密码。

## 显示与刷新规则

- 使用 DSH 官方 `conversation.composer.dock` 槽位，位于输入框下方，与会话统计同一区域；不修改 DSH 程序文件。
- **剩余百分比 = 100 − 后台采集的已用百分比**；上下限为 0–100%。不把多个账号的额度相加。
- 重置时间按绝对时间戳计算，每秒更新倒计时；倒计时不触发上游请求。
- 自动模式下定时读取已保存快照；点刷新按钮会调用账号对应的真实用量接口。Codex 主动查询可能触发 sub2api 的上游用量探测；10 秒内不能重复主动查询。
- 多个会话共用查询缓存；页面隐藏或没有挂载用量栏时停止客户端轮询。
- 未配置密钥或账号时显示配置提示。后台未采集某个窗口时显示未知，不把它当作 100% 剩余。
- 网络失败保留同一账号的最近成功数据并标记过期；切换账号、服务地址或密钥时不会沿用旧账号数据。
- 已经过重置时间的快照显示等待刷新，不擅自重置为满额。旧采集时间会在详情中显示。

默认 **自动** 模式以较低频率读取账号 `extra` 中的已采集数据，避免后台持续触发上游探测。点击输入框下方的刷新按钮会绕过快照改用主动用量接口：Codex 使用 `source=active`，Claude OAuth 使用 `source=active`，Claude setup-token 使用 `source=passive`。Codex 主动接口在部分 sub2api 版本中可能发送合成 `/responses` 请求来探测窗口，因此手动刷新可能触发上游请求。若接口没有提供采集时间，界面会注明时间未知；展示的是该次主动查询返回值，而不是声称已有可验证的采样时间。

部分 Codex 账号的被动快照只会写入 7 天窗口（`codex_7d_*`），此时 5 小时窗口在自动快照下显示「未知」。sub2api 的用量接口本身能返回两个窗口，把用量源改为 `active` 即可显示；主动接口自带采样时间，插件按该时间判断数据新旧，不会误标为旧数据。

高级用量源：

- `passive`：定时读取 Anthropic 账号的被动窗口数据；仅适用于 Claude，后台可能依据会话状态估算。
- `active`：每个刷新周期都调用主动用量接口。Codex 在部分版本中可能发起合成模型请求来探测用量；仅在需要并接受此行为时选择。插件不发送 `force=true`。
- `auto`：定时读取快照；手动刷新时才主动查询。Codex 可能触发上游用量探测，Claude setup-token 使用被动接口。

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

客户端以普通 ESM 源码维护，构建为 DSH `window.__ModuleLoader__.load` 模块。预构建产物提交到仓库，支持 GitHub 安装。插件声明兼容 DSH `>=0.2.2-rc.1 <0.2.3-0`，已在 `0.2.2-rc.3` 上验证；其他版本需要重新验证。

测试使用模拟 sub2api 响应，覆盖百分比/时间单位、Codex 与 Claude 快照、未知数据、过期数据、请求缓存、密钥切换、同源访问限制、官方槽位、轮询清理和客户端构建。没有使用真实管理员密钥或消耗订阅额度。真实服务验收需要安装后在本机设置管理员 Key 和账号。

## 接口依据

本插件根据 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 的公开实现适配：

- [账号管理接口](https://github.com/Wei-Shaw/sub2api/blob/4a4a83ee5ec86b19d3a2dd9b6471de5128963bec/backend/internal/handler/admin/account_handler.go)
- [用量窗口和快照字段](https://github.com/Wei-Shaw/sub2api/blob/4a4a83ee5ec86b19d3a2dd9b6471de5128963bec/backend/internal/service/account_usage_service.go)
- [管理员 API Key 认证](https://github.com/Wei-Shaw/sub2api/blob/4a4a83ee5ec86b19d3a2dd9b6471de5128963bec/backend/internal/server/middleware/admin_auth.go)

第三方独立插件，与 DeepSeek、OpenAI、Anthropic 和 Sub2API 官方无隶属关系。MIT License。
