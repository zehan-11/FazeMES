# 任务一 · 人脸识别登录

员工在登录页填写租户和账号。首次使用密码进入 MES，点右上角头像 → 人脸登录设置。勾选本人授权后，开启摄像头、采集 1 至 3 张单人正脸、输入当前密码并提交。退出后在登录页点「本人人脸登录」。个人设置也支持更新、撤销和查看补清状态。UI 使用 localhost 或 HTTPS。

管理员在系统管理 → 角色管理中给指定员工角色分配 MES 系统父菜单和「本人人脸登录」（971290）。工作台使用该角色原有的业务权限。给管理角色分配「用户查询」与用户管理下的「管理人脸绑定」（971291），在用户管理列表的「更多」中填写原因后执行“停用刷脸”或“要求本人重录”。部门数据权限继续由 MES 维护。停用禁止本人自行开通；经管理员要求重录后，员工可用密码登录并录入新版。

## 在新电脑上启用本地人脸登录

适用于已能密码登录 FazeMES、准备使用一个新的人脸向量库的 Windows、macOS 和 Linux 电脑。如果当前 MES 已有向量绑定，继续使用原向量库及其凭据，迁移时应连同向量数据一起备份和恢复。

1. 安装并启动支持 Linux 容器的 Docker 和 Docker Compose v2（支持 `up --wait`），安装 PowerShell 7.2 或更新版本和 64 位 Python 3.13。首次安装需要能下载 Python 二进制包、OpenCV 模型及 pgvector 镜像。
2. 在项目根目录运行以下命令。已初始化的 Windows 电脑可在命令末尾加上 `-StartMes`，一次完成配置、后端构建和 MES 启动。

   ```powershell
   pwsh -NoProfile -File deploy/start-face-local.ps1
   ```

   脚本校验模型哈希，启动仅监听本机的识别服务，创建持久化向量库、行级隔离策略和独立应用账号。默认识别端口 8091、数据库端口 55439。重复执行会复用同一套凭据和数据。请一并备份 MySQL、`.runtime/face-vector`、`.runtime/face-auth` 及向量库数据卷。
3. **Windows** 如果上一步已使用 `-StartMes`，直接进入第 4 步。也可以从项目根目录单独运行 `pwsh -NoProfile -File deploy/resume-local.ps1 -Build`，等待前后端就绪。常规启动器需要通过 `MYSQL_HOME`、既有安装路径或 `PATH` 找到 MySQL 工具。以后可以用「普通启动」。**macOS / Linux** 先按下节对 MySQL 执行增量迁移，再按原方式构建并从项目根目录重启 MES；从其他目录启动时，将 `.runtime/face-vector/connection.yaml` 的绝对文件 URI 追加到现有 `spring.config.additional-location` 列表。原有的 `MES_FACE_AUTH_*` 环境变量和 Java 命令行覆盖项需与所选实例一致。
4. 密码登录，进入「人脸登录设置」，确认服务就绪后录入本人样本，再退出并刷脸验证。浏览器使用本机 localhost 或 HTTPS，并允许摄像头访问。主机重启后先启动 Docker，再启动人脸服务及 MES。

如果已经安装原生 PostgreSQL 16、pgvector 和命令行工具 psql，也可以使用独立的新数据库 `fazemes_face`。通过环境变量 `PGUSER` 和本机密码文件为 psql 配置数据库所有者凭据，该账号须有创建角色和安装扩展的权限。运行 `pwsh -NoProfile -File deploy/start-face-local.ps1 -UseLocalPostgres -VectorPort 5432`（端口按实际调整），即可跳过 Docker。已有生产绑定的迁移按下节处理。

## 数据库升级与启动

1. 备份 MySQL、权限配置以及原人脸主密钥，限制备份读权限。对已有环境使用增量迁移，安排维护窗口停止旧版人脸写入。先在独立 PostgreSQL 13+ 数据库安装 pgvector。以下以 psql 中的数据库所有者执行一次，运行账号使用独立密码。

   ```sql
   CREATE ROLE fazemes_face_app LOGIN NOSUPERUSER NOBYPASSRLS;
   \password fazemes_face_app
   CREATE DATABASE fazemes_face;
   \connect fazemes_face
   \i database/postgresql/20261127_face_sample.sql
   ```

2. 在 MySQL 使用项目的 `deploy/apply-migrations.ps1` 增量入口（已有数据库）。新迁移为 `database/migrations/20261127_face_versions.sql`，前置迁移为 `20261018_face_login.sql`。脚本按校验和记账。若使用独立自建的迁移工具，按相同顺序执行并登记。PostgreSQL 脚本只在 PostgreSQL 执行。
3. 在运行后端的服务环境中配置 `MES_FACE_AUTH_VECTOR_URL`（例如 `jdbc:postgresql://127.0.0.1:55436/fazemes_face`）、`MES_FACE_AUTH_VECTOR_USER=fazemes_face_app`、`MES_FACE_AUTH_VECTOR_PASSWORD`。保留原 `mes.face-auth.master-key-file` 的文件和路径，新实例需要指向原密钥才能读取旧密文。向量库采用专用低权限角色、行级安全策略和受限网络。pgvector 运算需要可计算的特征；部署时为 PostgreSQL 数据卷及备份启用存储加密。
4. 从项目根目录构建并沿用原 `meslocal` 配置启动。人脸 worker 使用同一套已校验的 YuNet、SFace 模型；worker 和 Java 读取同一个本地令牌文件，默认端口 8091。

   ```sh
   mvn -s deploy/maven-local-settings.xml -f backend/pom.xml -pl yudao-server -am package -DskipTests
   export FACE_RUNTIME_DIR="$(pwd -P)/.runtime/face-auth"
   python3 face-auth/app.py --model-dir "$FACE_RUNTIME_DIR/models" --token-file "$FACE_RUNTIME_DIR/service.key"
   # 另一终端，从项目根目录运行。FACE_RUNTIME_DIR 指向上一步 worker 使用的目录。
   export FACE_RUNTIME_DIR="$(pwd -P)/.runtime/face-auth"
   java -jar backend/yudao-server/target/yudao-server.jar --spring.profiles.active=meslocal --spring.config.additional-location=file:./.runtime/application-meslocal.yaml --mes.face-auth.token-file="$FACE_RUNTIME_DIR/service.key"
   # 前端终端
   cd frontend
   pnpm install --frozen-lockfile
   pnpm dev
   ```

5. 使用独立副本时给 MySQL、Redis、worker、API、UI 分配各自的本地端口。前端通过 `VITE_API_PROXY_TARGET` 指向新 API。验证登录页 `/login`、个人 `/mes/face`、管理员 `/system/user`。管理员更新角色后，员工重新登录以刷新菜单。

## 核验、过渡和补清

- MySQL 管理授权时间、授权文案版本、状态、修订号和当前样本版本。已有有效密文登记为 LEGACY，过往授权时间保持空值。本人重新授权并成功录入后才发布 PGVECTOR 版本并清空旧密文。失败保留原绑定。
- 核验消费原 Redis 的 60 秒一次性请求。Java 对所声明账号查询 MySQL，再在 PostgreSQL 的同一租户、用户、版本、模型内计算最大余弦相似度。计算式为 `1 - (embedding <=> probe)`，阈值为 0.54。核验完成后在 MySQL 行锁下复查状态和版本，再签发标准 MES 会话。该流程没有活体检测。
- 修改接口接受 `expectedRevision` 和 UUID `requestId`。重试同一操作时复用标识。候选样本的补清任务先持久化，随后在 PostgreSQL 单事务写完全部样本，最后在 MySQL 切换当前版本。撤销、管理员停用或要求重录在 MySQL 提交时生效。已登录会话沿用系统现有退出规则。
- 补清任务使用 `(tenant_id,user_id,template_version)` 精确删除，默认每 15 秒检查。不可用时延期 30 秒重试；未发布候选的回收宽限期为 120 秒。可在 MySQL 查看 `SELECT COUNT(*), MIN(due_at), MAX(attempts) FROM mes_face_cleanup;`。恢复 PostgreSQL 或修正连接信息后等待队列归零。密码登录和本人撤销不依赖向量服务。
- 测试数据重置保留待清理队列。完整清除模式会先把将要删除的当前向量版本加入队列；保留配置模式沿用原有的所有者校验，保留幸存账号的绑定。重启调度后检查队列及专用向量库。跨库备份须同时包含 MySQL、向量库和旧主密钥。
- 业务审计位于 `mes_face_audit`，仅保留操作者、目标账号、操作、原因、结果、请求标识和时间。采集帧仅在当前页面和本地处理链的内存中短暂停留。管理页只展示绑定状态。从 PostgreSQL 日志和数据库监控配置中关闭绑定值记录（含错误参数）；勿在网关或抓包服务记录认证请求体。

## 回退

1. 在入口暂停人脸接口的写入及刷脸登录，让在途操作结束。保留新版后端补清调度。确认 MySQL、PostgreSQL 及原加密主密钥的备份可读。
2. 在 MySQL 对对应业务库执行 `database/rollback/20261127_face_versions.sql`。它使已发布向量版本失效，登记按版本删除的任务，并写入回退审计。已撤销、已停用的记录保持失效。可重复执行。
3. 等待 `SELECT COUNT(*) FROM mes_face_cleanup;` 为零。向量库离线时保留任务及调度，恢复后继续。用数据库维护账号确认该专用库的 `mes_face_sample` 无遗留；应用账号受 RLS 约束，未设定租户/用户的计数不能作为全库清理证据。
4. 部署基线前后端。旧版本运行期间关闭人脸 worker 或在网关禁用 `/mes/face/login` 和 `/mes/face/enroll`，员工使用密码。旧版没有管理员停用策略。保留新增字段、队列、迁移登记和审计表，供审计与再次升级。向量切换时已清除旧密文的账号需本人重新授权录入；恢复历史备份前须重放之后的撤销操作。

## 开发验证

使用独立数据库和虚构测试账号。pgvector 集成测试以非所有者应用角色执行。设置环境变量 `FAZE_FACE_TEST_PG` 和 `FAZE_FACE_TEST_PASSWORD`，然后从仓库根目录运行。

```sh
mvn -s deploy/maven-local-settings.xml -f backend/pom.xml -pl yudao-module-mes -am test -Dtest=FaceVectorStoreIT,MesFaceAuthServiceTest,FaceTemplateCipherTest -Dsurefire.failIfNoSpecifiedTests=false
node --test frontend/tests/face-camera.test.cjs
python3 -m unittest discover -s face-auth -p test_app.py
```

Python 测试使用已安装 `face-auth/requirements.txt` 的解释器；实际模型用例从 `.runtime/face-auth/models` 读取并校验文件。真人摄像头验收需由本人在浏览器授权，在不同光照、不同人员和拒绝授权情形下分别记录结果。
