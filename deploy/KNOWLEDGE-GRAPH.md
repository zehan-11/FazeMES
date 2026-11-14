# 知识图谱：第一步渲染原型

## 入口与范围

启动项目后，在「AI助手与知识库 → 知识图谱」打开。
与现有知识模块共用 query/knowledge/manage 权限入口，无新增匿名路由。
需具备 knowledge 或 manage 权限；切换离开图谱 tab 时卸载 WebGL 组件。

当前内容：15 个实体、16 条有向关系，全部是人工编写的电风扇教学示例。
界面显式标注演示数据，关系来源也是人工示例，未关联实际上传文件。
支持拖动旋转、缩放、自动旋转开关、重置、节点选择及关联高亮、实体列表
搜索、通过列表聚焦节点、查看有向关系及来源。列表支持键盘操作。
尊重 prefers-reduced-motion；页面隐藏/视图离开屏幕暂停帧循环；卸载时
清理 ResizeObserver、IntersectionObserver、事件监听、OrbitControls 和 GPU 资源。
WebGL 不可用时展示错误，并保留实体和关系列表。

## 迁移边界

复用 Galaxy View 的 AggregateRenderer、节点 shader、曲线链接、星空、星云、
辉光与显示坐标拟合。独立于 Obsidian，Vue 控制页和 OrbitControls 替代原
GraphController/Obsidian UI。原力学 Worker、CameraDirector 和 Obsidian 笔记
索引未迁移，原型采用确定性螺旋初始坐标。未新增 npm 依赖，兼容项目现有
Three.js 0.160。starfield 构造参数移除未使用的 private 修饰以满足本项目类型检查。
完整 MIT 许可证保留在 vendor 目录及公开 licenses 路径，并在界面署名。
上游版本、commit 与清单见 src/vendor/galaxy-view/README.md 和
仓库根目录 THIRD-PARTY-SOURCES.json。

## 下一步接口边界

`graphData.ts` 定义 KnowledgeGraph（实体、关系、关系来源）。实体和关系均用
稳定字符串 ID，toGalaxyData 将 ID 映射到渲染器数组索引，验证重复 ID 和悬空关系。
当前无数据库驱动、凭据、请求或文件上传；前端不得直接连接 Neo4j。
后续 Spring Boot 查询 Neo4j 后返回相同结构，再替换 demoGraph 数据来源。
届时仍需增加租户/用户范围校验、分页/节点上限、异步邻居展开、错误处理、
去重合并与删除同步。当前不是完整 GraphRAG，不含文件抽取或模型问答。

## 验证

在 frontend 目录运行：

```powershell
node --test tests/knowledge-graph.test.cjs
pnpm exec eslint src/views/mes/graph src/views/mes/assistant/index.vue
pnpm exec stylelint "src/views/mes/graph/*.vue"
pnpm ts:check
pnpm build:local
```

页面检查：搜索「轴承」、选择节点、核对关系方向、展开来源、清空搜索、
重置视角、切换旋转、切换 tab 后重新进入，以及窄屏排版。
