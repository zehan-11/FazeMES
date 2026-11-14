# Neo4j 知识图谱接入

## 启动与入口

复用本机 Neo4j 安装，首次运行：

```powershell
pwsh -File deploy/neo4j-local.ps1 -Neo4jHome "你的 Neo4j 安装目录" -JavaHome "兼容的 JDK 目录"
python -m pip install -r deploy/requirements-graph.txt
python -X utf8 deploy/seed-knowledge-graph.py --tenant-id 1 --owner-id 1
pwsh -File deploy/start-with-graph.ps1 -Build
```

数据库在项目 `.runtime/neo4j/data`；Bolt 使用 127.0.0.1:7688，管理页使用
127.0.0.1:7475。已有 Neo4j 安装的数据、密码和配置不会改变。
独立凭据在 `.runtime/neo4j/connection.local.json` 和
`.runtime/application-graph.local.yaml`，均不提交 Git。安装与 JDK 路径保存到
`.runtime/neo4j/tools.local.json`，日后启动可省略参数。
正常启动使用 `deploy/start-with-graph.ps1`，停止使用 `deploy/stop-with-graph.ps1`。
导入脚本只在显式执行时运行，按节点/关系的范围和稳定 ID 幂等写入，不清空库。
初始化内容为电风扇维护关系，数据在 database/graph/fan-knowledge.json。
首次为哪个用户导入，必须显式指定其租户和用户 ID。

网页入口：AI助手与知识库 → 知识图谱，或 `/mes/assistant?tab=graph`。
提供实体搜索、选择、展开邻居、关联高亮、旋转缩放、关系方向与来源查看。
前端只通过 Spring Boot 查询，不含 Neo4j 密码或本地图谱备用数据。
连接失败显示错误并清空当前图谱，不以旧数据冒充查询成功。

## 数据与接口

- 节点 `FazeEntity`：tenantId、ownerId、id、name、kind、description。
- 关系 `FazeRelation`：tenantId、ownerId、id、type、sourceTitle、sourceSection、sourceExcerpt。
- 节点与关系均以 `(tenantId,ownerId,id)` 作为复合唯一约束。
- 节点、关系及两端节点必须全部满足当前用户/租户范围；范围取自后端认证上下文，
  不接收客户端指定的 tenantId/ownerId。管理员也不会默认读取他人私有图谱。
- `/admin-api/mes/knowledge-graph/overview`：初始 8 节点，上限 200。
- `/search?query=...`：名称/类型查询，上限 50，默认 30。
- `/node?id=...`：私有范围内的实体详情；范围外与不存在统一返回错误。
- `/neighbors?id=...`：一跳邻居，默认 20，上限 100；范围内的有向关系最多 500。
- `hasMore` 表示响应截断；浏览器合并按稳定 ID 去重，总量上限 200 节点/500 关系。
- 所有接口要求 `mes:assistant:knowledge` 或 `mes:assistant:manage` 权限。
- Cypher 值均参数化，连接异常不向客户端返回凭据或底层连接详情。

目前实现图数据库查询与展示，不含文件自动抽取、文件版本同步或 GraphRAG 问答。
GraphSource 仍保留来源契约，后续可扩展文档 ID、页码、片段与版本信息。

## 源码与渲染

Galaxy View 的 AggregateRenderer、节点 shader、曲线、星空、星云与辉光按 MIT 复用，
原作者署名、许可证及固定 commit 保留。没有 Obsidian 运行时依赖。
原力学 Worker/CameraDirector 未迁移，采用确定性初始布局和 OrbitControls。
视图更新会释放旧渲染器；隐藏/离屏暂停帧循环；卸载清理观察器、事件和 GPU 资源。

## 检查

```powershell
# frontend 目录
node --test tests/knowledge-graph.test.cjs
pnpm exec eslint src/views/mes/graph src/api/mes/graph
pnpm exec stylelint "src/views/mes/graph/*.vue"
pnpm ts:check
pnpm build:local
# 仓库根目录
python -X utf8 deploy/verify-knowledge-graph.py
# 测试数据库不可用时的明确错误，测试后必须恢复启动
pwsh -File deploy/neo4j-local.ps1 -Action Stop
python -X utf8 deploy/verify-knowledge-graph.py --expect-unavailable
pwsh -File deploy/neo4j-local.ps1
```

后端测试 `MesKnowledgeGraphServiceTest` 覆盖身份、权限、所有节点/关系范围、参数化、
限额与错误脱敏；真实库测试 `MesKnowledgeGraphLiveTest` 仅在显式设置
`FAZEMES_GRAPH_TEST_CONFIG` 为本地连接 JSON 路径时执行。它使用 UUID 命名的测试
节点，验证跨用户/跨租户及关系范围，finally 中只清理本次专属测试节点。
