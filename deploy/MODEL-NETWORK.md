# 模型连接：虚拟 IP、真实 DNS 与本机代理

模型配置入口仍为「AI助手与知识库 → 模型配置」。OpenAI 的服务地址填写
`https://api.openai.com/v1`；API Key 只在该页面提交，不写入代理配置或源码。

## 默认行为

- 普通模型请求读取 Windows 当前用户的系统 HTTP 代理；支持同一端口、按协议设置
  的端口及 ProxyOverride。代理状态每3秒刷新，不需要关闭 Clash 虚拟网卡/TUN。
- 仅允许连接本机 HTTP/混合代理端口，不支持 SOCKS、远程代理或代理账号密码。
  本地 `127.0.0.1` 模型请求始终直连。
- 如果 `api.openai.com` 的系统解析包含 `198.18.0.0/15` 虚拟地址，或解析失败，
  后端通过 Cloudflare DoH 查询真实 IPv4 公网地址。DoH 使用固定解析器引导地址
  `1.1.1.1`，仍验证 `cloudflare-dns.com` 的 TLS 证书；不依赖系统再解析该解析器。
  DoH 经过原模型目标选中的本机代理，不向解析器发送 API Key、问题或文档。
- DoH 校验查询名、A/CNAME 来源和返回地址；任一目标私网地址都会被拒绝。
  缓存不超过 DNS 返回的 TTL，且最多60秒；失败不回退到虚拟 IP。
- 模型连接（包括 CONNECT）固定使用校验后的真实 IP，TLS SNI、证书校验及 Host
  仍使用原服务域名；不关闭证书验证，不追随重定向，也不在请求失败后自动重复
  发送模型内容。
- 本功能只调整 FazeMES 后端的解析和连接，不改 Windows DNS、hosts 或 Clash 配置。
  因此系统 nslookup/Resolve-DnsName 仍可能显示虚拟 IP；这不表示后端仍使用它。

DoH JSON 请求和字段依据
[Cloudflare 官方文档](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。

## 可选后端配置

默认即可适配本项目中的 OpenAI 地址。需要显式配置时可在本地 Spring 配置中加入：

```yaml
mes:
  model:
    proxy-url: system
    real-dns-hosts: api.openai.com
```

`proxy-url` 可填 `system`、`direct` 或 `http://127.0.0.1:实际HTTP端口`。
`real-dns-hosts` 是由运维配置的精确域名列表（英文逗号分隔，空字符串禁用恢复），
不支持通配符，也不由网页调用者提交。配置项修改后重启后端，系统代理开关和
端口变更则无需重启。Jev 原有的 `mes.jev.proxy-url` 仍独立生效。

当前实现恢复 A 记录；没有 IPv4 网络时需要后续增加 AAAA 连接策略。
DoH 查询超时上限10秒，模型传输仍使用原有总截止时间，不扩大响应体和连接权限。

## 验证

后端测试：`MesModelNetworkTest`、`MesAssistantModelGatewayTest`、`MesJevSystemProxyTest`。
额外设置环境变量 `FAZEMES_MODEL_NETWORK_LIVE=1` 后运行 `MesModelNetworkLiveTest`，
会在当前网络上验证真实 DNS、系统代理、TLS 和 OpenAI HTTP 响应；不携带 API Key，
不调用模型，预期得到 `/v1/models` 的 HTTP 401（缺少认证）。
401 在这里仅证明网络连接完成，不能证明实际密钥、模型权限或问答已配置成功。
