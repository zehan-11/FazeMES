# 文档向量链路：第一步（Embedding连接）

当前仅完成Embedding配置、真实API调用及连接测试。文档自动向量化、Neo4j向量索引、
向量更新删除与语义检索尚未接通；现有文档检索仍使用BM25。

入口：AI助手与知识库 → 模型配置 → 文档向量模型（Embedding）。
先保存OpenAI兼容接口和API Key，再保存Embedding模型、维度和启用开关，然后测试。
默认模型为text-embedding-3-small，默认1536维。回答模型与Embedding模型独立设置。
连接测试仅向服务商发送固定测试文字，返回向量维度、数量和用量；不读取知识文件。
未来启用文档向量化时，文档片段也会发送给该API服务商。

## 接口和配置

- GET /admin-api/mes/assistant/embedding-config：脱敏配置与连接就绪状态。
- PUT /admin-api/mes/assistant/embedding-config：model、dimensions、enabled。
- POST /admin-api/mes/assistant/embedding-config/test：固定文字的真实连接测试。

三者均要求mes:assistant:config权限。配置按认证租户隔离，保存在
mes_assistant_embedding_config；接口地址和加密密钥复用mes_assistant_model_config，
不复制密钥，也不将密钥或完整向量返回页面。重置模型配置时同时移除本租户Embedding设置。
本步骤不改变原有回答模型配置。

Embedding复用既有DNS校验、HTTPS连接、代理、超时、响应大小上限和禁止重定向处理。
不在业务数据库事务内调用外部接口，不自动重试API请求。每批最多16段，每段UTF-8
最多8192字节、总计最多64KiB，作为输入token上限的保守限制。模型实际token用量从
API响应读取；服务商费用与限额由服务商决定，项目不设置计费配额。

仅接受完整批次、唯一且合法的index、预期维度、有限数值及非零向量，并按index恢复
输入顺序。返回的spaceId由接口地址、模型和维度计算，供后续向量空间隔离使用。

## 升级与验证

先通过现有deploy/apply-migrations.ps1应用20261115_embedding_configuration.sql，
再构建并重启后端；不手动修改已应用的迁移文件。

MesEmbeddingGatewayTest覆盖真实本地HTTP协议、批次乱序、租户隔离、配置独立性、
非法输入、事务边界、异常向量和服务商错误。MesAssistantControllerPolicyTest验证配置权限。

实际调用已配置平台：

```powershell
python -X utf8 deploy/verify-embedding.py --model --enable-default
```

--enable-default会在Embedding未启用时保存默认模型并启用；省略该参数可测试已保存配置。
脚本只发送固定测试文字，核对聊天配置保持一致，不输出密钥、完整向量或私有资料。

参考：[OpenAI Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)、
[向量模型说明](https://developers.openai.com/api/docs/guides/embeddings)。
