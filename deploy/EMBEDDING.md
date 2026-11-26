# 文档向量链路：Embedding与Neo4j入库

已完成独立Embedding配置、文档发布后的异步向量化、持久化批次进度、Neo4j向量索引写入，以及文件版本更新、撤回和删除同步。
现已接通按权限的关键词、语义和综合检索，以及基于这些证据的文档/图谱混合问答。向量入库状态与本次实际检索策略分别展示。

## 使用

AI助手与知识库 → 模型配置 → 文档向量模型（Embedding）。复用已保存的OpenAI兼容接口和
加密API Key，默认text-embedding-3-small、1536维，独立于回答模型。连接测试只发送固定测试文字。

上传文档先保存草稿，不调用外部模型。发布后登记后台任务，分批将文档片段发送给所配置的API平台，
成功后写入Neo4j。“RAG知识库”上方显示已发布文件的向量覆盖、待处理和待清理数量，
文件列表显示分块进度、模型、维度及重试入口。任务处理期间状态自动更新，也可手动刷新。
点击“在此库语义检索”进入知识助手，自动选中当前库与语义策略。输入问题后可先检索证据，
也可发送提问并点击引用核对原文。
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

## 文档检索与问答

在“知识助手”保留文档、图谱、混合三种模式。文档与混合模式增加文档策略：

- 关键词（LEXICAL）：中文BM25，不调用Embedding，不依赖Neo4j向量索引。
- 语义（SEMANTIC）：只使用当前已入库的向量片段；配置或连接异常时明确失败，不冒充关键词结果。
- 综合（COMBINED）：分别取得关键词与语义候选，按RRF排名融合，常数k=60；不相加两类原始分数。
  语义通道不可用、没有当前索引或没有有效语义候选时，只返回当前关键词结果并明确标记降级与原因。

网页默认综合；未提交documentStrategy的旧API请求默认关键词，旧会话默认LEXICAL。
图谱模式不调用问题Embedding；混合模式在文档策略结果上继续合并带来源的图谱路径。
独立“检索证据”会在语义/综合策略下将本次问题发送给已配置的Embedding平台，不生成聊天答复。
每次只向量化问题；发布时已生成的文档向量留在本地Neo4j，不在查询时整库发送给平台。

### 权限、版本与来源复核

先从认证上下文取得当前可访问的已发布分块，再用MySQL向量状态限制当前版本、上传者、知识库、
片段数量、模型空间及INDEXED状态。只有这些文件ID被传入Neo4j SEARCH的索引内过滤条件，
租户与文件过滤发生在ANN的top-k之前，不依靠全库top-k后隐藏未授权结果。
若Neo4j在索引恢复期间执行ANN查询报错，服务会使用同一问题向量，在授权文件的当前有效片段中按余弦相似度排序。
备用查询最多比较20,000个片段，事务超时为5秒。Neo4j无法访问时，语义模式报告错误，综合模式标明关键词降级。

问题Embedding返回后、ANN执行后都重新检查权限和当前来源。候选同时核对文件检查点active、
版本、任务代次、模型/维度、分块ID、哈希、原文、页码及字符位置；返回文本以当前授权MySQL原文为准。
不返回完整向量。旧版本、草稿、删除、撤权、旧代次和错误来源候选不会进入证据。

每次最多50个语义候选、30个关键词候选、10条返回证据；ANN为近似检索，分数只用于排序，
不代表答案正确率或可信度。关键词、语义原始分数与各自排名保存在retrievalDetails供界面核对，
综合结果的score为RRF排名分。未完成当前模型索引的资料仍可参与关键词通道，并显示覆盖提示。

发送提问时，前后复核所选向量来源的当前权限、模型空间、版本及代次，且直接读取对应Neo4j来源，
不会为了复核再次生成问题向量或重复ANN。语义/综合无证据时不调用聊天模型；这两种文档策略和
图谱/混合模式均校验答案引用编号。该校验不等于自动证明每条回答都被原文支持，仍需核对引用。

历史消息保存documentStrategy和documentRetrieval（请求策略、实际策略、降级、警告、覆盖量），
保留独立引用快照。新问题只选同模式、同文档策略且当前有效的历史上下文；旧索引或撤权引用不会
通过历史绕过当前检查。检索失败也会释放会话请求，允许重试；生成期间来源变化时拒绝旧答复。

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
被冒充为已经物理删除。该标志表示当前版本索引就绪；只有选择语义或综合策略时，本次文档检索才会使用向量通道。

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

- POST /admin-api/mes/assistant/search、/evidence/search、/message：增加documentStrategy（LEXICAL/SEMANTIC/COMBINED）。
  检索与答复返回documentRetrieval，证据增加retrievalDetails；会话记录保存实际策略与降级信息。
- GET/PUT /admin-api/mes/assistant/embedding-config：独立配置；要求mes:assistant:config。
- POST /admin-api/mes/assistant/embedding-config/test：固定测试文字；要求mes:assistant:config。
- POST /admin-api/mes/assistant/document/vector/rebuild?id=...&expectedVersion=...：重试或重建已发布文件；
  入口要求知识库功能权限，服务层再次检查实际文件维护权限。
- GET /admin-api/mes/assistant/documents：增加vectorStatus、vectorChunkCount、vectorCompletedChunks、
  vectorAttempts、vectorError、vectorModel、vectorDimensions、vectorIndexName，以及上文的有效性与清理状态字段。

已有本地环境先启动 Neo4j，再用项目现有启动脚本恢复服务。使用 PowerShell 7，在仓库根目录执行：

```powershell
pwsh -File deploy/neo4j-local.ps1
pwsh -File deploy/resume-local.ps1 -Build
```

`resume-local.ps1` 调用迁移脚本，按记录补齐 `20261115_embedding_configuration.sql`、
`20261115_vector_document_ingestion.sql` 和 `20261115_document_retrieval_strategy.sql` 等迁移。
前端入口为 `http://127.0.0.1:5173/mes/assistant`。使用电脑已有的运行配置和模型凭据。

## 任务二验收口径

| 必做内容 | 核对方式 |
| --- | --- |
| 大模型接入 | 使用已配置的 OpenAI 接口执行实际 Embedding 和带引用问答。课件允许选用本地模型或 API。 |
| 本地隐私知识库与用户隔离 | MySQL 和 Neo4j 在本地存储。双账号检查个人库、管理员边界和企业库角色授权、撤权。启用 OpenAI 时，平台会收到向量化所需的发布片段和检索问题，以及生成答复所需的问题和引用。 |
| 多格式文件管理 | TXT、Markdown、CSV、DOCX、文本型 PDF，核对上传后分块、原文件下载与发布检索。更新、历史版本、撤回和删除另走生命周期验收。单文件上限 5 MB，扫描 PDF 需先 OCR。 |
| 向量数据库与更新 | 发布和替换后的重新发布触发后台向量化。更新、撤回和删除提交后旧内容立即退出检索，Neo4j 的物理清理异步完成。验证并发版本冲突、恢复重试和其他文件保留。 |
| 私有 RAG 问答 | 检查关键词、语义、综合策略，核对真实答复、可点击引用、会话策略和来源权限。 |

### Dify 本地问答演示

本机 Dify 1.20.0 工作室运行独立的设备点检问答。打开工作室选中「FazeMES · 设备点检手册问答」，点击运行，输入「巡检发现设备异响时记录哪些信息？」。知识检索节点查询私有教学手册（经济模式、关键词索引），有命中时调用本机 Ollama 的 `qwen2.5:0.5b`，输出回答和来源原文。输入「银河系黑洞的质量是多少？」可验证未命中分支，运行记录中可以核对模型节点是否执行。

编排文件为 [dify-knowledge-workflow.yml](dify-knowledge-workflow.yml)。导入其他工作区后，重新选择该工作区的知识库，添加设备点检示例手册，配置本地模型端点并测试两条分支。本机使用 Docker Desktop，工作室入口为 `http://127.0.0.1:18780/apps`，部署目录为 `D:/FazeMES-Dify-1.20.0/docker`。重启时先启动 Docker Desktop 和 Ollama，再在部署目录执行 `docker compose up -d`。本机代理仅为模型推理额外放行向 `host.docker.internal:11434/api/generate` 发出的 POST 请求。

在 FazeMES 的「知识助手」打开「设备手册问答 · Dify」，输入问题并点击「运行 Dify 问答」。这个入口仅查询 Dify 的设备点检示例库，沿用知识助手的聊天和知识库权限。FazeMES 后端调用已发布工作流，按 Dify 返回的运行 ID 与节点执行 ID 归集事件，结束后将答案、来源片段与执行顺序返回页面。「查看本次执行流程」打开该次问答的彩色长带，点节点可核对分支、耗时、来源或输出。「在 Dify 中查看编排画布」在新标签页打开原生工作室。原有文档、图谱和混合问答使用各自原有的知识库范围。

后端配置项为 `mes.dify.base-url`（本机默认 `http://127.0.0.1:18780/v1`）及 `mes.dify.api-key`（已发布应用的 API 密钥）。本机把密钥保存在 Git 忽略的 `.runtime/application-meslocal.yaml`，修改后重启后端。前端 `VITE_DIFY_STUDIO_URL` 仅设置编排画布链接，切换工作区后可在对应 Vite 环境中更新。运行历史可在 Dify 工作室按运行 ID 核对。

## 本地实测记录

- 从知识助手页面运行上述两道题，命中时执行 7 个节点并返回 1 条手册片段，未命中时执行 5 个节点。按运行 ID 在 Dify 工作室核对，两次长带上的节点执行 ID、名称和顺序均与原始记录一致。
- 五种文件格式的接口验收通过 36 项检查，包括原文件字节、分块哈希、字符位置和 PDF 页码。
- 双账号验收通过个人库隔离、企业库角色授权与撤销，以及向量检索来源隔离。
- 使用同一组临时中文资料时，验收用英文问题的关键词检索返回 0 条，语义检索返回 2 条。
  文档语义问答有 2 条引用，文档和图谱混合问答有 4 条引用，两次会话均保留实际检索策略。
- 实际发起两个持有同一文件版本号的更新请求，只有一个成功。更新、撤回和删除均验证了旧向量立即退出检索，
  后台清理完成后其他文档向量仍保持完整。
- 实际停启Neo4j。停机时清理进入重试，严格语义检索报错，综合检索明确降级为关键词。恢复后清理自动重试，
  语义检索恢复，临时文件随后清理完成。使用真实Neo4j另外验证了索引报错时的备用查询及授权范围。
- 浏览器已核对知识库覆盖总览和“在此库语义检索”入口。点击后选中原知识库和语义策略。

## 复现验收

本地服务启动后，使用项目配置的 OpenAI 接口运行：

```powershell
python -X utf8 deploy/verify-assistant-rag.py
python -X utf8 deploy/verify-knowledge-access.py --semantic
python -X utf8 deploy/verify-semantic-rag.py --model
python -X utf8 deploy/verify-vector-lifecycle.py --model --exercise-recovery
```

这些脚本使用新建的合成资料和问题，并清理自身创建的资料、账号和会话。最后一条会短时停启本机
Neo4j，核对断线时关键词降级和恢复后的清理任务。系统正在演示时，可省略 `--exercise-recovery`
完成文件与索引生命周期核对。额外的 Embedding 连接测试和单文档入库测试可单独复现：

```powershell
python -X utf8 deploy/verify-embedding.py --model
python -X utf8 deploy/verify-document-vectors.py --model
```

后端 `MesDocumentVectorPipelineTest` 覆盖已完成批次的断点恢复和过期任务。`MesDocumentVectorStoreLiveTest`
使用真实 Neo4j 检查索引过滤和数据隔离，运行时把 `FAZEMES_GRAPH_TEST_CONFIG` 指向本机 Neo4j 配置文件。

参考 [OpenAI Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create) 和
[Neo4j 向量索引](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/vector-indexes/)。
