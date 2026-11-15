# 文档向量链路：Embedding与Neo4j入库

已完成独立Embedding配置、文档发布后的异步向量化、持久化批次进度、Neo4j向量索引写入，以及文件版本更新、撤回和删除同步。
当前问答中的文档检索仍使用BM25；语义检索与问答接入将在后续步骤实现，不能将“已入库”视为已启用向量问答。

## 使用

AI助手与知识库 → 模型配置 → 文档向量模型（Embedding）。复用已保存的OpenAI兼容接口和
加密API Key，默认text-embedding-3-small、1536维，独立于回答模型。连接测试只发送固定测试文字。

上传文档先保存草稿，不调用外部模型。发布后登记后台任务，分批将文档片段发送给所配置的API平台，
成功后写入Neo4j。在RAG知识库文件列表查看“文档向量”的状态、完成片段数、模型和维度。
失败可点击“重试向量入库”；已入库的文件可明确选择“重新建立索引”。重建操作携带expectedVersion，
文件版本变化时需刷新。维护权限沿用原个人库所有权与企业规则库授权，普通读取成员不能重建。

本次升级不自动处理原有已发布资料。维护者可以在文件列表按需点击“建立向量索引”，或在后续发布时处理。
未配置Embedding时文件仍可发布，向量状态为WAITING_CONFIG，原有关键词检索继续可用。
启用或变更配置后，维护者需明确重试/重建；任务不会自动改用另一服务商发送原任务资料。

## 交付与恢复

1. MySQL文件事务中登记mes_assistant_vector_state，包含文件、上传者、库、版本、任务代次、
   不可变分块快照和模型空间标识；事务回滚时任务一同回滚。
2. 专用后台工作线程领取已提交任务，每轮最多2份文件、每份最多8个片段。领取任务使用短事务和
   180秒租约；外部Embedding请求在事务之外执行，不持有文件行锁。
3. 调用前检查当前文件和模型空间，响应后再次校验任务代次。已确认成功的批次保存在
   mes_assistant_vector_chunk，后续批次、Neo4j暂时失败或程序重启都可从已完成批次恢复。
4. 全部片段就绪后，建立并确认向量索引ONLINE，在Neo4j单事务中替换该文件的全部向量片段，
   然后确认MySQL状态为INDEXED并清理临时批次数据。两个数据库采用至少一次交付，写入按文件和
   代次幂等。API超时或进程恰在响应后中断时无法保证只计费一次，已持久化成功的批次不会重复请求。
5. 单批次/入库连续失败最多自动尝试5次，按20/40/80/160秒退避；页面保留真实错误和进度，
   不将失败显示为成功。租约过期可恢复；最后一次尝试也中断时转为失败，避免永久显示处理中。
6. 更新后回到草稿、撤回或删除均推进代次并登记清理，不调用Embedding。处理中收到旧响应时
   不写入新状态。清理仅移除该文件向量，失败后持续重试，不影响其他文件。

MySQL会短暂保留文件分块快照与向量批次，成功或新代次登记后清理。Neo4j保留小型文件检查点
作为代次屏障，拒绝迟到旧任务再次恢复已移除片段；检查点不保存原文或完整向量。
撤回、删除到Neo4j物理清理为异步过程。后续向量检索仍必须以当前MySQL权限、发布状态、版本和
当前模型空间为准，不能仅凭Neo4j节点存在判断资料可用。

## 更新、撤回、删除与当前有效性

更新文件时仍使用expectedVersion校验，解析成功后归档旧原文与分块，新版回到草稿。
同一文件的旧向量立即标记为不可用，并进入后台清理；重新发布后为新版建立索引。
新版可以在旧清理尚未执行前重新发布，最终写入仍只包含最新版本，迟到的旧任务不能覆盖它。
解析失败或过时版本请求不会改变当前发布版本及其向量状态。

撤回立即退出当前文档检索，向量失效；Neo4j物理清理异步完成，状态明确区分“建立索引”和
“移除旧向量”。删除后文件退出列表、原文入口和当前检索；页面说明后台继续清理，
不把删除接口返回成功描述为Neo4j已经清理完成。删除任务失败后持续自动重试，即使Embedding
已停用或清理失败超过5次，清理也不依赖外部模型，不因模型停用而中断。

文件列表新增vectorAction（INDEX/REMOVE/NONE）、vectorUsable、vectorTaskVersion、
vectorIndexedVersion和vectorSyncedAt。vectorUsable只有在当前文件已发布、入库成功、版本、
上传者、知识库、片段数与当前Embedding模型空间一致时才为true。模型配置变化或停用时，
列表直接显示CONFIG_CHANGED或WAITING_CONFIG，vectorUsable为false；已有Neo4j节点不会因此
被冒充为已经物理删除。该标志表示当前版本的索引就绪，不表示已接通语义问答。

重复发布或重复撤回同一版本不会推进任务代次，也不会打断已领取任务或重复调用Embedding。
主动“重新建立索引”仍会按明确的重建操作处理。删除、更新、发布和向量提交统一先锁文件行，
避免删除先锁分块、更新先锁文件所形成的锁顺序冲突。

## Neo4j结构与来源

- FazeVectorDocument：租户、文件、原上传者、知识库、版本、任务代次、模型空间及active标志。
- FazeVectorChunk：上述来源字段，以及chunkId、chunkIndex、chunkHash、heading、text、
  pageNumber（如有）、startOffset、endOffset和embedding。
- 每个接口地址、模型名、维度组合生成稳定spaceId，使用独立FazeVector_<spaceId>标签和
  fazemes_vector_<spaceId>向量索引；余弦索引保留租户、库、文件、版本、上传者和代次过滤属性。
- 向量片段不使用FazeEntity/FazeRelation标签，原有星系实体图谱不会因此混入文档片段。
- 所有数据库凭据与完整向量留在后端，不通过列表或测试接口返回浏览器。

实际本地Neo4j为Community 2026.08.1。索引使用Cypher 25创建，维度固定，建成后核验ONLINE。
Embedding输入沿用最多16段、单段UTF-8最多8192字节、总计64KiB的网关限制；后台每批最多8段。
维度、数量、索引顺序、有限值与非零向量均校验；API不在业务事务中调用。

## 接口与升级

- GET/PUT /admin-api/mes/assistant/embedding-config：独立配置；要求mes:assistant:config。
- POST /admin-api/mes/assistant/embedding-config/test：固定测试文字；要求mes:assistant:config。
- POST /admin-api/mes/assistant/document/vector/rebuild?id=...&expectedVersion=...：重试或重建已发布文件；
  入口要求知识库功能权限，服务层再次检查实际文件维护权限。
- GET /admin-api/mes/assistant/documents：增加vectorStatus、vectorChunkCount、vectorCompletedChunks、
  vectorAttempts、vectorError、vectorModel、vectorDimensions、vectorIndexName，以及上文的有效性与清理状态字段。

应用20261115_embedding_configuration.sql与20261115_vector_document_ingestion.sql后构建重启后端。
使用现有deploy/apply-migrations.ps1，不修改已经应用的迁移文件。

## 验证

MesDocumentVectorPipelineTest覆盖草稿、回滚、分批、故障恢复、租约、文件变更、配置变化与维护权限；
MesDocumentVectorStoreLiveTest在隔离测试租户中验证真实Neo4j索引、来源、独立文件、旧代次屏障和图谱保持，
需要FAZEMES_GRAPH_TEST_CONFIG指向本机私有Neo4j配置，测试结束仅清理自身节点和临时索引。

```powershell
python -X utf8 deploy/verify-embedding.py --model
python -X utf8 deploy/verify-document-vectors.py --model
python -X utf8 deploy/verify-vector-lifecycle.py --model
```

第二个脚本只使用新建的验收资料，经正常上传、发布、等待入库后逐片核对Neo4j来源和维度，最后删除并
验证本次文件的向量清理。不发送原有私人文件，不输出密钥或完整向量。

参考：[OpenAI Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)、
[Neo4j向量索引](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/vector-indexes/)。

第三个脚本使用两份新建资料验证：同内容的独立文件、重复发布、版本冲突拒绝、更新后立即失效、
旧向量物理清理、新版来源、历史原文、撤回后重发、删除清理，以及其他文件保持完整。
脚本经正常API操作，调用已配置Embedding平台，不改动原有文件或模型配置，结束后清理自身资料。
