<template>
  <KnowledgeLaunchOverlay v-if="moduleIntro && tab !== 'graph'" @done="moduleIntro = false" />
  <section class="mes-assistant-page" :class="{ 'is-graph': tab === 'graph' }">
    <el-tag
      class="model-status"
      :type="modelStatus?.configured ? 'success' : 'info'"
      :title="modelLabel"
    >
      {{ modelLabel }}
    </el-tag>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="assistant-alert"
    />
    <el-tabs v-model="tab" class="assistant-tabs">
      <el-tab-pane v-if="canKnowledge || canManage" label="知识图谱" name="graph">
        <KnowledgeGraph v-if="tab === 'graph'" ref="graphView" @open-document="preview" />
      </el-tab-pane>
      <el-tab-pane v-if="canBusiness" label="业务 Agent" name="business">
        <BusinessAssistant :active="tab === 'business'" @navigate="openBusinessAnalysis" />
      </el-tab-pane>
      <el-tab-pane v-if="canBusiness || canChat || canKnowledge" label="Agent 协同" name="works">
        <FanWorksWorkbench
          v-if="tab === 'works'"
          @knowledge-settings="worksScopeOpen = true"
          :ask-knowledge="sendKnowledgeQuestion"
          :knowledge-scope="{
            knowledgeBaseIds: selectedBases,
            mode: retrievalMode,
            documentStrategy,
            hops: retrievalHops
          }"
        />
      </el-tab-pane>
      <el-tab-pane v-if="canChat || canKnowledge" label="知识助手" name="chat">
        <div class="assistant-layout" :class="{ 'assistant-without-sidebar': !canChat }">
          <aside class="assistant-sidebar" v-if="canChat">
            <el-button type="primary" plain :disabled="sending" @click="newSession"
              >新建会话</el-button
            >
            <div class="assistant-session-list">
              <button
                v-for="item in sessions"
                :key="item.id"
                class="assistant-session"
                :class="{ active: sessionId === item.id }"
                :disabled="sending"
                @click="openSession(item.id)"
              >
                <span>{{ item.title }}</span
                ><small>{{ time(item.updateTime) }}</small>
              </button>
              <el-empty v-if="!sessions.length" description="暂无会话" :image-size="50" />
            </div>
          </aside>
          <main class="assistant-chat">
            <div class="assistant-chat-toolbar">
              <KnowledgeScopeControls
                v-model:selected-bases="selectedBases"
                v-model:retrieval-mode="retrievalMode"
                v-model:document-strategy="documentStrategy"
                v-model:retrieval-hops="retrievalHops"
                :bases="bases"
                :sending="sending"
              />
              <DifyAssistant v-if="canChat && canKnowledge" @journey="openJourney" />
              <el-button plain @click="openJourney()">预览流程示例</el-button>
              <el-button v-if="sessionId" text :disabled="sending" @click="renameSession"
                >重命名</el-button
              >
              <el-button
                v-if="sessionId"
                text
                type="danger"
                :disabled="sending"
                @click="removeSession"
                >删除会话</el-button
              >
            </div>
            <el-alert
              v-if="!modelStatus?.configured"
              title="模型未配置：可以检索真实文档和查看引用，不会生成或伪造模型答复。管理员可在“模型配置”接入服务。"
              type="info"
              :closable="false"
              show-icon
            />
            <div class="assistant-messages" ref="messagesElement" v-loading="historyLoading">
              <div v-if="!messages.length && !searchResult" class="assistant-welcome"
                ><h3>从一份真实文档开始</h3
                ><p>上传并发布工艺规范、设备手册或质量文件，再提问并核对来源。</p
                ><p>支持检索与多轮对话；会话仅对当前用户可见。</p></div
              >
              <article
                v-for="(item, messageIndex) in messages"
                :key="item.id"
                class="assistant-message"
                :class="item.role"
              >
                <div class="assistant-message-label"
                  >{{ item.role === 'user' ? '我的提问' : `AI助手 · ${item.modelName}`
                  }}<small
                    >{{ modeLabels[item.retrievalMode || 'DOCUMENT']
                    }}{{
                      item.retrievalMode !== 'DOCUMENT' && item.retrievalMode
                        ? ` · ${item.retrievalHops || 2}跳`
                        : ''
                    }}
                    {{
                      item.retrievalMode !== 'GRAPH'
                        ? ` · ${strategyLabels[item.documentStrategy || 'LEXICAL']}`
                        : ''
                    }}
                    · {{ time(item.createTime) }}</small
                  ></div
                >
                <template v-if="item.role === 'assistant' || item.status !== 'ANSWERED'">
                  <el-alert
                    v-for="warning in item.documentRetrieval?.warnings || []"
                    :key="warning"
                    :title="warning"
                    :type="item.documentRetrieval?.degraded ? 'warning' : 'info'"
                    :closable="false"
                  />
                </template>
                <AnswerText
                  v-if="item.role === 'assistant'"
                  :content="item.content"
                  :citations="item.citations || []"
                  @citation="viewCitation"
                />
                <div v-else class="assistant-message-content">{{ item.content }}</div>
                <el-alert
                  v-if="item.role === 'user' && item.status !== 'ANSWERED'"
                  :title="
                    item.status === 'PROCESSING'
                      ? '此请求正在处理，提问已保存。长时间未完成时可重新打开会话核查。'
                      : item.status === 'NO_EVIDENCE'
                        ? '当前范围内没有足够证据，本次未调用模型。请使用具体实体名、调整知识库范围或发布相关文件。'
                        : item.status === 'MODEL_NOT_CONFIGURED'
                          ? '模型未配置，本次没有模型答复。以下为真实检索结果。'
                          : '模型服务未能返回答复；本次检索依据仍可查看。'
                  "
                  type="info"
                  :closable="false"
                />
                <div
                  v-if="
                    item.citations?.length &&
                    (item.role === 'assistant' || item.status !== 'ANSWERED')
                  "
                  class="assistant-citations"
                >
                  <button
                    v-for="(citation, index) in item.citations"
                    :key="citation.evidence?.evidenceId || citation.chunkId"
                    @click="viewCitation(citation)"
                    ><b>[{{ index + 1 }}] {{ citation.title }}</b
                    ><span
                      >{{
                        citation.relation
                          ? `${citation.relation.source} → ${citation.relation.type} → ${citation.relation.target}`
                          : citation.heading
                      }}{{ citation.pageNumber ? ` · 第${citation.pageNumber}页` : ''
                      }}{{ citation.version ? ` · v${citation.version}` : '' }}</span
                    ></button
                  >
                </div>
                <el-button
                  v-if="item.role === 'assistant' || item.status !== 'ANSWERED'"
                  link
                  type="primary"
                  @click="openMessageJourney(item, messageIndex)"
                  >查看本次问答流程</el-button
                >
              </article>
              <el-button
                v-if="searchResult"
                plain
                @click="openJourney(searchJourney(searchResult))"
              >
                查看本次检索流程
              </el-button>
              <EvidenceResults v-if="searchResult" :result="searchResult" />
            </div>
            <div class="assistant-composer">
              <p v-if="retrievalMode !== 'GRAPH'" class="assistant-field-help">
                语义或综合检索会调用已配置的Embedding平台处理本次问题。相似度用于排序，请结合原文核对。
              </p>
              <p v-if="retrievalMode !== 'DOCUMENT'" class="assistant-field-help"
                >可先检索核对实体、关系和来源，再发送提问生成带引用的答复。</p
              >
              <el-input
                v-model="question"
                type="textarea"
                :rows="3"
                maxlength="4000"
                show-word-limit
                :placeholder="
                  retrievalMode === 'DOCUMENT'
                    ? '例如：设备点检发现异常时，应如何处理？Ctrl + Enter 发送'
                    : '例如：电风扇有哪些关联故障？点击检索证据'
                "
                :disabled="sending"
                @keydown.ctrl.enter.prevent="send"
              />
              <div class="assistant-composer-actions"
                ><span>{{ chatNotice }}</span
                ><el-button
                  :loading="searching"
                  :disabled="sending || !question.trim() || question.length > 1000"
                  @click="search"
                  >检索证据</el-button
                ><el-button
                  v-if="canChat && canKnowledge"
                  type="primary"
                  :loading="sending"
                  :disabled="!question.trim() || searching"
                  @click="send"
                  >发送提问</el-button
                ></div
              >
            </div>
          </main>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canKnowledge || canManage" label="RAG知识库" name="knowledge">
        <div class="assistant-knowledge-layout">
          <aside class="assistant-sidebar"
            ><el-button v-if="canKnowledge || canManage" type="primary" plain @click="editBase()"
              >新建知识库</el-button
            ><template v-for="kind in ['PERSONAL', 'RULES']" :key="kind">
              <p v-if="bases.some((base) => base.libraryType === kind)" class="mt-16px mb-8px">{{
                kind === 'PERSONAL' ? '我的个人知识库' : '企业规则库'
              }}</p>
              <button
                v-for="base in bases.filter((item) => item.libraryType === kind)"
                :key="base.id"
                type="button"
                class="assistant-session"
                :class="{ active: knowledgeBaseId === base.id }"
                @click="selectBase(base.id)"
              >
                <span>{{ base.name }}</span
                ><small
                  >{{ base.documentCount }} 份文档 · {{ base.canManage ? '可维护' : '只读' }}</small
                >
              </button> </template
            ><el-empty v-if="!bases.length" description="暂无知识库" :image-size="60"
          /></aside>
          <section class="assistant-documents">
            <template v-if="currentBase">
              <div class="assistant-document-heading"
                ><div
                  ><h3>{{ currentBase.name }}</h3
                  ><p>{{ currentBase.description || '暂无知识库描述' }}</p></div
                ><div v-if="currentBase.canManage"
                  ><el-button @click="editBase(currentBase)">编辑</el-button
                  ><el-button type="danger" plain @click="removeBase">删除知识库</el-button
                  ><el-button type="primary" @click="openUpload()">上传文档</el-button></div
                ></div
              >
              <div class="assistant-index-overview" aria-label="文档向量覆盖">
                <div>
                  <strong>文档向量覆盖</strong>
                  <p role="status" aria-atomic="true">
                    {{ indexSummary.ready }} /
                    {{ indexSummary.published }} 份已发布文档可用于语义检索
                    <template v-if="indexSummary.pending">
                      · {{ indexSummary.pending }} 份正在处理</template
                    >
                    <template v-if="indexSummary.needsAttention">
                      · {{ indexSummary.needsAttention }} 份待建立或重试</template
                    >
                    <template v-if="indexSummary.removing">
                      · {{ indexSummary.removing }} 份旧向量待清理</template
                    >
                  </p>
                </div>
                <div class="assistant-index-actions">
                  <el-button :loading="documentsLoading" @click="loadDocuments()"
                    >刷新状态</el-button
                  >
                  <el-button
                    v-if="canKnowledge"
                    type="primary"
                    plain
                    :disabled="sending || !indexSummary.ready"
                    @click="searchCurrentBase"
                  >
                    在此库语义检索
                  </el-button>
                </div>
              </div>
              <el-alert
                title="支持 TXT / MD / CSV、DOCX 和文本型 PDF（最多 5MB）。上传后请审核并发布。发布后自动处理向量，入库完成即可语义检索。扫描 PDF 需先 OCR。"
                type="info"
                show-icon
                :closable="false"
              />
              <el-collapse class="mt-12px">
                <el-collapse-item title="普通手册与关系文件如何建图" name="graph-format">
                  <p
                    >上传普通中文设备手册并发布后，会自动识别常见的部件组成、故障原因和处理措施。</p
                  >
                  <pre>
这台电风扇配有一台电机。
电机由轴承和转子组成。
轴承异响可能由润滑不足引起。</pre
                  >
                  <p
                    >建图抽取在本地执行。系统也支持箭头关系和“源实体、关系、目标实体”三列表格或
                    CSV。未匹配到支持的句式或格式时，文档会显示“未识别关系”。</p
                  >
                  <a href="/templates/knowledge-relations.md" download>下载关系文档模板</a>
                </el-collapse-item>
              </el-collapse>
              <el-table
                :data="documents"
                v-loading="documentsLoading"
                class="assistant-document-table"
                empty-text="当前知识库没有可见文档"
                row-key="id"
              >
                <el-table-column
                  prop="title"
                  label="文档标题"
                  min-width="180"
                  show-overflow-tooltip
                />
                <el-table-column prop="fileType" label="格式" width="80" />
                <el-table-column prop="version" label="版本" width="70" />
                <el-table-column prop="chunkCount" label="分块" width="75" />
                <el-table-column label="状态" width="90"
                  ><template #default="{ row }"
                    ><el-tag :type="row.status === 'PUBLISHED' ? 'success' : 'info'">{{
                      row.status === 'PUBLISHED' ? '已发布' : '草稿'
                    }}</el-tag></template
                  ></el-table-column
                >
                <el-table-column label="知识图谱" min-width="180">
                  <template #default="{ row }">
                    <el-tag
                      :type="
                        row.graphStatus === 'SYNCED'
                          ? 'success'
                          : ['ERROR', 'INVALID'].includes(row.graphStatus)
                            ? 'danger'
                            : 'info'
                      "
                      >{{ graphStatusText(row.graphStatus) }}</el-tag
                    >
                    <div
                      >{{ row.graphEntityCount || 0 }} 个实体 ·
                      {{ row.graphRelationCount || 0 }} 条关系</div
                    >
                    <small v-if="row.graphError">{{ row.graphError }}</small>
                  </template>
                </el-table-column>
                <el-table-column label="文档向量" min-width="200">
                  <template #default="{ row }">
                    <el-tag
                      :type="
                        row.vectorStatus === 'INDEXED'
                          ? 'success'
                          : ['ERROR', 'CONFIG_CHANGED', 'STALE'].includes(row.vectorStatus)
                            ? 'danger'
                            : 'info'
                      "
                    >
                      {{ vectorStatusText(row.vectorStatus, row.vectorAction) }}
                    </el-tag>
                    <div v-if="row.vectorUsable"
                      >当前版本 v{{ row.vectorIndexedVersion }} 已入库</div
                    >
                    <div v-else-if="row.vectorAction === 'REMOVE'"
                      >旧向量已失效，正在等待清理完成</div
                    >
                    <div v-if="row.vectorChunkCount"
                      >{{ row.vectorCompletedChunks }} / {{ row.vectorChunkCount }} 个片段</div
                    >
                    <el-progress
                      v-if="row.vectorAction === 'INDEX' && row.vectorChunkCount > 0"
                      :percentage="
                        Math.min(
                          100,
                          Math.round((row.vectorCompletedChunks / row.vectorChunkCount) * 100)
                        )
                      "
                      :show-text="false"
                      :aria-label="`${row.title}向量处理进度`"
                    />
                    <small v-if="row.vectorModel"
                      >{{ row.vectorModel }} · {{ row.vectorDimensions }} 维</small
                    >
                    <div v-if="row.vectorError"
                      ><small>{{ row.vectorError }}</small></div
                    >
                    <el-button
                      v-if="currentBase.canManage && row.status === 'PUBLISHED'"
                      link
                      type="primary"
                      :disabled="
                        ['PENDING', 'PROCESSING'].includes(row.vectorStatus) ||
                        vectorSubmitting.has(row.id)
                      "
                      @click="rebuildDocumentVectors(row)"
                    >
                      {{
                        row.vectorStatus === 'NOT_INDEXED'
                          ? '建立向量索引'
                          : row.vectorStatus === 'INDEXED'
                            ? '重新建立索引'
                            : '重试向量入库'
                      }}
                    </el-button>
                  </template>
                </el-table-column>
                <el-table-column label="操作" min-width="400"
                  ><template #default="{ row }"
                    ><el-button link type="primary" @click="preview(row.id)">原文与分块</el-button
                    ><el-button link @click="downloadDocument(row)">下载</el-button
                    ><el-button
                      v-if="currentBase.canManage"
                      link
                      type="primary"
                      @click="openUpload(row)"
                      >更新文件</el-button
                    ><el-button v-if="currentBase.canManage" link @click="showVersions(row)"
                      >历史版本</el-button
                    ><el-button
                      v-if="currentBase.canManage"
                      link
                      type="primary"
                      @click="publishDocument(row)"
                      >{{ row.status === 'PUBLISHED' ? '撤回' : '发布' }}</el-button
                    ><el-button
                      v-if="currentBase.canManage"
                      link
                      :disabled="row.graphStatus === 'PENDING'"
                      @click="rebuildDocumentGraph(row)"
                      >重新建图</el-button
                    ><el-button
                      v-if="currentBase.canManage"
                      link
                      type="danger"
                      @click="removeDocument(row)"
                      >删除</el-button
                    ></template
                  ></el-table-column
                >
              </el-table> </template
            ><el-empty v-else description="选择或新建知识库" />
          </section>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canConfig" label="模型配置" name="config">
        <div class="assistant-config">
          <el-alert
            title="本项目不设置模型计费、次数或Token累计配额；模型平台自身额度仍以服务商为准。关键词检索不调用模型；语义检索和Embedding测试会调用已配置的平台。"
            type="info"
            :closable="false"
          />
          <el-alert
            title="API Key仅提交到本地后端并加密保存。页面不会读取已保存的密钥；聊天和检索不会接收服务地址或密钥。"
            type="info"
            show-icon
            :closable="false"
          />
          <el-form
            label-width="120px"
            :model="config"
            :disabled="embeddingTesting || embeddingSaving"
            v-loading="configLoading"
            class="assistant-config-form"
            @submit.prevent
          >
            <el-form-item label="服务类型"
              ><el-select v-model="config.provider" @change="changeProvider"
                ><el-option label="OpenAI兼容接口" value="openai" /><el-option
                  label="本地Ollama"
                  value="ollama" /></el-select
            ></el-form-item>
            <el-form-item label="服务地址"
              ><el-input
                v-model="config.baseUrl"
                maxlength="500"
                placeholder="https://api.openai.com/v1"
              /><p class="assistant-field-help"
                >外部服务必须使用HTTPS；本地开发允许
                http://127.0.0.1:11434。禁止私网、metadata、URL凭据和重定向。</p
              ></el-form-item
            >
            <el-form-item label="模型名称"
              ><el-input
                v-model="config.model"
                maxlength="200"
                placeholder="填写服务中实际可用的模型名称"
            /></el-form-item>
            <el-form-item label="API Key"
              ><el-input
                v-model="apiKey"
                type="password"
                show-password
                autocomplete="new-password"
                maxlength="4096"
                :placeholder="
                  config.apiKeyConfigured ? '已配置；留空保留原密钥' : '尚未配置；Ollama可留空'
                "
              /><p class="assistant-field-help"
                >{{
                  config.apiKeyConfigured ? '后端已保存加密密钥。' : '后端未保存密钥。'
                }}
                留空不覆盖；更换服务主机时需重新输入或清除。</p
              ><el-checkbox v-model="clearApiKey"
                >明确清除已保存的API Key</el-checkbox
              ></el-form-item
            >
            <el-form-item label="温度"
              ><el-input-number
                v-model="config.temperature"
                :min="0"
                :max="1.5"
                :step="0.1"
                :precision="2"
            /></el-form-item>
            <el-form-item label="最大输出长度"
              ><el-input-number v-model="config.maxTokens" :min="128" :max="4096" :step="128"
            /></el-form-item>
            <el-form-item label="模型上下文长度">
              <el-input-number
                v-model="config.contextTokens"
                :min="2048"
                :max="131072"
                :step="1024"
              />
              <p class="assistant-field-help"
                >填写服务实际支持的上下文token上限。系统按UTF-8字节数作保守估算，预留输出空间；自动减少引用并成对淘汰旧问答，必要资料仍超限时明确拒绝。</p
              >
            </el-form-item>
            <el-form-item label="启用模型"><el-switch v-model="config.enabled" /></el-form-item>
            <el-form-item
              ><el-button type="primary" :loading="configSaving" @click="saveConfig"
                >保存配置</el-button
              ><el-button :loading="testing" :disabled="configSaving" @click="testConfig"
                >测试已保存连接</el-button
              ></el-form-item
            >
          </el-form>
          <el-alert
            v-if="connectionMessage"
            :title="connectionMessage"
            :type="connectionSuccess ? 'success' : 'error'"
            show-icon
            :closable="false"
          />
          <el-divider content-position="left">文档向量模型（Embedding）</el-divider>
          <p class="assistant-field-help">
            复用上方已保存的OpenAI接口和API
            Key，单独设置向量模型。连接测试仅发送测试文字；发布文档后会分批生成向量并写入Neo4j；文档片段会发送给该平台。
          </p>
          <el-form
            label-width="120px"
            :model="embedding"
            :disabled="embeddingTesting || embeddingSaving || configSaving"
            v-loading="configLoading"
            class="assistant-config-form"
            @submit.prevent
          >
            <el-form-item label="Embedding模型">
              <el-input
                v-model="embedding.model"
                maxlength="200"
                placeholder="text-embedding-3-small"
              />
            </el-form-item>
            <el-form-item label="向量维度">
              <el-input-number v-model="embedding.dimensions" :min="1" :max="4096" :step="1" />
              <p class="assistant-field-help"
                >text-embedding-3-small默认1536维。维度须与模型支持范围一致。</p
              >
            </el-form-item>
            <el-form-item label="启用Embedding">
              <el-switch v-model="embedding.enabled" />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="embeddingSaving"
                :disabled="embeddingTesting || configSaving"
                @click="saveEmbeddingConfig"
              >
                保存Embedding配置
              </el-button>
              <el-button
                :loading="embeddingTesting"
                :disabled="embeddingSaving || configSaving || !embeddingCanTest"
                @click="testEmbeddingConfig"
              >
                测试已保存Embedding连接
              </el-button>
              <p class="assistant-field-help">先保存接口、密钥和Embedding配置，再测试连接。</p>
            </el-form-item>
          </el-form>
          <el-alert
            v-if="embeddingMessage"
            :title="embeddingMessage"
            :type="embeddingSuccess ? 'success' : 'error'"
            role="status"
            aria-live="polite"
            show-icon
            :closable="false"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </section>

  <el-dialog
    v-model="baseVisible"
    :title="baseForm.id ? '编辑知识库' : '新建知识库'"
    width="min(560px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!baseSaving"
    :show-close="!baseSaving"
    ><el-alert v-if="baseError" :title="baseError" type="error" :closable="false" class="mb-12px" />
    <el-form label-width="80px" @submit.prevent
      ><el-form-item label="类型" required>
        <el-select v-model="baseForm.libraryType" :disabled="!!baseForm.id" aria-label="知识库类型">
          <el-option label="个人知识库（仅自己）" value="PERSONAL" />
          <el-option v-if="canConfig" label="企业规则库（按角色授权）" value="RULES" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="baseForm.libraryType === 'RULES'" label="可读角色">
        <el-select
          v-model="baseForm.readerRoleIds"
          multiple
          filterable
          :loading="rolesLoading"
          placeholder="选择允许读取的角色"
          aria-label="企业规则库可读角色"
        >
          <el-option v-for="role in baseRoles" :key="role.id" :label="role.name" :value="role.id" />
        </el-select>
        <p>留空时仅创建者和管理员可读；角色成员只能检索已发布资料。普通成员不能修改规则。</p>
      </el-form-item>
      <el-alert
        v-else
        title="个人知识库仅本人可访问，管理员也不会默认读取他人的个人资料。"
        type="info"
        :closable="false"
        class="mb-12px" />
      <el-form-item label="名称" required
        ><el-input v-model="baseForm.name" maxlength="100" /></el-form-item
      ><el-form-item label="描述"
        ><el-input
          v-model="baseForm.description"
          type="textarea"
          :rows="3"
          maxlength="1000" /></el-form-item></el-form
    ><template #footer
      ><el-button @click="baseVisible = false">取消</el-button
      ><el-button type="primary" :loading="baseSaving" @click="saveBase">保存</el-button></template
    ></el-dialog
  >
  <el-dialog
    v-model="uploadVisible"
    :title="uploadTarget ? `更新文件 · 当前 v${uploadTarget.version}` : '上传并解析知识文档'"
    width="min(560px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!uploading"
    :show-close="!uploading"
    ><el-alert
      v-if="uploadTarget"
      type="warning"
      :closable="false"
      show-icon
      title="更新后保存为新版本草稿，并移除旧版图谱关系。审核并重新发布后，新版才参与检索和建图；历史版本保留。"
      class="mb-16px"
    />
    <el-alert
      v-if="uploadError"
      :title="uploadError"
      type="error"
      :closable="false"
      class="mb-16px"
    />
    <label for="knowledge-upload-title">文档标题</label>
    <el-input
      id="knowledge-upload-title"
      v-model="uploadTitle"
      placeholder="文档标题（留空使用文件名）"
      maxlength="200"
      class="assistant-upload-title"
    /><el-upload
      ref="uploadElement"
      drag
      :auto-upload="false"
      :limit="1"
      accept=".txt,.md,.csv,.docx,.pdf"
      :on-change="fileChanged"
      :on-remove="() => (uploadFile = undefined)"
      ><div>点击或拖入文档</div
      ><template #tip><div>单个文件最多5MB。解析后的草稿需审核发布。</div></template></el-upload
    ><template #footer
      ><el-button :disabled="uploading" @click="uploadVisible = false">取消</el-button
      ><el-button
        type="primary"
        :loading="uploading"
        :disabled="!uploadFile"
        @click="uploadDocument"
        >{{ uploadTarget ? '保存新版本' : '上传并分块' }}</el-button
      ></template
    ></el-dialog
  >
  <el-dialog v-model="citationVisible" title="可追溯引用" width="min(820px, 92vw)">
    <template v-if="activeCitation">
      <h3>{{ activeCitation.title }}</h3>
      <p v-if="activeCitation.relation"
        >{{ activeCitation.relation.source }} → {{ activeCitation.relation.type }} →
        {{ activeCitation.relation.target }}</p
      >
      <p
        >{{ activeCitation.heading
        }}{{ activeCitation.version ? ` · v${activeCitation.version}` : ''
        }}{{ activeCitation.pageNumber ? ` · 第${activeCitation.pageNumber}页` : '' }}</p
      >
      <pre class="assistant-source-text">{{ activeCitation.content }}</pre>
      <p v-if="activeCitation.contentHash" class="assistant-hash"
        >片段 SHA-256：{{ activeCitation.contentHash }}</p
      >
      <el-button
        v-if="activeCitation.documentId"
        @click="preview(activeCitation.documentId, activeCitation.version)"
        >查看当前授权原文</el-button
      >
    </template>
  </el-dialog>
  <el-dialog
    v-model="versionsVisible"
    :title="`${versionsDocument?.title || '文档'} · 版本记录`"
    width="min(820px, 94vw)"
  >
    <el-table
      :data="versions"
      v-loading="versionsLoading"
      row-key="version"
      empty-text="暂无版本记录"
    >
      <el-table-column label="版本" width="100"
        ><template #default="{ row }"
          >v{{ row.version }}<el-tag v-if="row.isCurrent" size="small">当前</el-tag></template
        ></el-table-column
      >
      <el-table-column prop="fileName" label="文件" min-width="160" show-overflow-tooltip />
      <el-table-column prop="chunkCount" label="分块" width="75" />
      <el-table-column label="保存时状态" width="110"
        ><template #default="{ row }">{{
          row.status === 'PUBLISHED' ? '已发布' : '草稿'
        }}</template></el-table-column
      >
      <el-table-column label="操作" width="170"
        ><template #default="{ row }"
          ><el-button link type="primary" @click="preview(row.id, row.version)">查看原文</el-button
          ><el-button link @click="downloadDocument(row, row.version)">下载</el-button></template
        ></el-table-column
      >
    </el-table>
    <p>历史版本用于核对来源，不参与当前检索或建图。更新文件不会自动发布。</p>
  </el-dialog>
  <el-dialog
    v-model="journeyVisible"
    :title="journeyData?.trace ? '本次 Dify 执行流程' : '问答流程预览'"
    width="min(1440px, 96vw)"
    top="3vh"
    destroy-on-close
    append-to-body
    :body-style="{ padding: '0' }"
  >
    <FanWorksReplay v-if="journeyData" :record="journeyData" />
    <WorkflowJourney v-if="journeyVisible" :journey="journeyData" @source="openJourneySource" />
  </el-dialog>
  <el-dialog
    v-if="canKnowledge"
    v-model="worksScopeOpen"
    title="知识库与检索设置"
    width="min(560px, 94vw)"
    append-to-body
    destroy-on-close
  >
    <div class="works-knowledge-settings"
      ><KnowledgeScopeControls
        v-model:selected-bases="selectedBases"
        v-model:retrieval-mode="retrievalMode"
        v-model:document-strategy="documentStrategy"
        v-model:retrieval-hops="retrievalHops"
        :bases="bases"
        :sending="sending"
    /></div>
    <template #footer
      ><el-button type="primary" @click="worksScopeOpen = false">完成</el-button></template
    >
  </el-dialog>
  <el-dialog v-model="previewVisible" title="原文与分块" width="85%"
    ><div v-loading="previewLoading" v-if="previewDocument"
      ><h3>{{ previewDocument.title }} · v{{ previewDocument.version }}</h3
      ><p
        >{{ previewDocument.fileName }} · {{ previewDocument.chunkCount }} 段 ·
        {{ previewDocument.status === 'PUBLISHED' ? '已发布' : '草稿' }}</p
      ><el-tabs
        ><el-tab-pane label="解析原文">
          <pre class="assistant-source-text assistant-full-text">{{
            previewDocument.contentText
          }}</pre></el-tab-pane
        ><el-tab-pane label="分块索引"
          ><article
            v-for="chunk in previewDocument.chunks"
            :key="chunk.chunkId"
            class="assistant-chunk"
            ><b
              >第{{ chunk.chunkIndex + 1 }}段 · {{ chunk.heading
              }}{{ chunk.pageNumber ? ` · 第${chunk.pageNumber}页` : '' }}</b
            ><pre class="assistant-source-text">{{ chunk.content }}</pre
            ><small class="assistant-hash"
              >字符位置 {{ chunk.startOffset }}—{{ chunk.endOffset }} · SHA-256
              {{ chunk.contentHash }}</small
            ></article
          ></el-tab-pane
        ></el-tabs
      ></div
    ></el-dialog
  >
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch
} from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile, UploadInstance } from 'element-plus'
import {
  AssistantApi,
  type AssistantMessage,
  type AssistantSession,
  type Citation,
  type KnowledgeBase,
  type KnowledgeDocument,
  type DocumentVersion,
  type ModelConfig,
  type ModelStatus
} from '@/api/mes/assistant'
import DifyAssistant from './DifyAssistant.vue'
import WorkflowJourney from './WorkflowJourney.vue'
import { messageJourney, searchJourney, type Journey, type JourneySource } from './workflowJourney'
import EvidenceResults from './EvidenceResults.vue'
import AnswerText from './AnswerText.vue'
import KnowledgeLaunchOverlay from './KnowledgeLaunchOverlay.vue'
import {
  searchEvidence,
  type EvidenceSearchResult,
  type DocumentStrategy,
  type RetrievalMode
} from '@/api/mes/assistant/evidence'
import { checkPermi } from '@/utils/permission'
import { formatAssistantTime as time } from './assistantTime'
import KnowledgeScopeControls from './KnowledgeScopeControls.vue'
import BusinessAssistant from '@/views/mes/insight/BusinessAssistant.vue'

const FanWorksWorkbench = defineAsyncComponent(() => import('./FanWorksWorkbench.vue'))
const FanWorksReplay = defineAsyncComponent(() => import('./FanWorksReplay.vue'))
const KnowledgeGraph = defineAsyncComponent(() => import('@/views/mes/graph/KnowledgeGraph.vue'))

defineOptions({ name: 'MesAssistant' })

const journeyVisible = ref(false)
const journeyData = ref<Journey>()
function openJourney(data?: Journey) {
  journeyData.value = data
  journeyVisible.value = true
}
function openMessageJourney(item: AssistantMessage, index: number) {
  const user = item.role === 'user' ? item : messages.value[index - 1]
  openJourney(messageJourney(user?.role === 'user' ? user.content : '此条答复未附提问', item))
}
function openJourneySource(source: JourneySource) {
  if (!source.doc) return
  journeyVisible.value = false
  void preview(source.doc, source.version ?? undefined)
}

const graphView = ref<{ replayLaunch: () => Promise<void> }>()
let wasDeactivated = false

onDeactivated(() => {
  journeyVisible.value = false
  moduleIntro.value = false
  wasDeactivated = true
})
onActivated(() => {
  if (!wasDeactivated) return
  wasDeactivated = false
  if (tab.value === 'graph') void graphView.value?.replayLaunch()
  else moduleIntro.value = tab.value !== 'works' && !reducedMotion.matches
})

const canChat = checkPermi(['mes:assistant:chat'])
const canKnowledge = checkPermi(['mes:assistant:knowledge'])
const canManage = checkPermi(['mes:assistant:manage'])
const canConfig = computed(() => checkPermi(['mes:assistant:config']))
const canBusiness = computed(
  () => checkPermi(['mes:insight:query']) && checkPermi(['mes:insight:chat'])
)
const assistantRoute = useRoute()
const availableTabs = [
  (canKnowledge || canManage) && 'graph',
  canBusiness.value && 'business',
  (canChat || canKnowledge) && 'chat',
  (canBusiness.value || canChat || canKnowledge) && 'works',
  (canKnowledge || canManage) && 'knowledge',
  canConfig.value && 'config'
].filter((item): item is string => Boolean(item))
const requestedTab = assistantRoute.query.tab
const tab = ref(
  typeof requestedTab === 'string' && availableTabs.includes(requestedTab)
    ? requestedTab
    : (availableTabs[0] ?? 'config')
)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const moduleIntro = ref(tab.value !== 'graph' && tab.value !== 'works' && !reducedMotion.matches)
watch(tab, () => {
  moduleIntro.value = false
})

const businessRouter = useRouter()
function openBusinessAnalysis(topic: string) {
  void businessRouter.push({ path: '/mes/insight', query: { tab: topic } })
}
const error = ref('')
const modelStatus = ref<ModelStatus>()
const modelLabel = computed(() =>
  modelStatus.value?.configured
    ? modelStatus.value.provider + ' · ' + modelStatus.value.model + '（凭据已配置）'
    : '模型尚未配置'
)
const bases = ref<KnowledgeBase[]>([])
const selectedBases = ref<number[]>([])
const worksScopeOpen = ref(false)
const knowledgeBaseId = ref<number>()
const currentBase = computed(() => bases.value.find((base) => base.id === knowledgeBaseId.value))
const sessions = ref<AssistantSession[]>([])
const sessionId = ref<number>()
const messages = ref<AssistantMessage[]>([])
const question = ref('')
const chatNotice = ref('')
const sending = ref(false)
const searching = ref(false)
const historyLoading = ref(false)
const searchResult = ref<EvidenceSearchResult>()
const modeLabels = { DOCUMENT: '文档问答', GRAPH: '图谱问答', HYBRID: '混合问答' }
const retrievalMode = ref<RetrievalMode>('DOCUMENT')
const documentStrategy = ref<DocumentStrategy>('COMBINED')
const strategyLabels = { LEXICAL: '关键词', SEMANTIC: '语义', COMBINED: '综合' }
const retrievalHops = ref<1 | 2>(2)
let evidenceRequest = 0
watch(
  [retrievalMode, documentStrategy, retrievalHops, question, () => selectedBases.value.join(',')],
  () => {
    ++evidenceRequest
    searchResult.value = undefined
    searching.value = false
  }
)
const messagesElement = ref<HTMLElement>()
const documents = ref<KnowledgeDocument[]>([])
const documentsLoading = ref(false)
const baseVisible = ref(false)
const baseSaving = ref(false)
const baseError = ref('')
const baseRoles = ref<{ id: number; name: string; code: string }[]>([])
const rolesLoading = ref(false)
const baseForm = reactive<{
  id?: number
  name: string
  description: string
  libraryType: 'PERSONAL' | 'RULES'
  readerRoleIds: number[]
}>({
  name: '',
  description: '',
  libraryType: 'PERSONAL',
  readerRoleIds: []
})
watch(
  () => baseForm.libraryType,
  (value) => {
    if (value === 'PERSONAL') baseForm.readerRoleIds = []
  }
)
const uploadVisible = ref(false)
const uploadTarget = ref<KnowledgeDocument>()
const uploadError = ref('')
const versionsVisible = ref(false)
const versionsLoading = ref(false)
const versionsDocument = ref<KnowledgeDocument>()
const versions = ref<DocumentVersion[]>([])
const uploadTitle = ref('')
const uploadFile = ref<File>()
const uploadElement = ref<UploadInstance>()
const uploading = ref(false)
const citationVisible = ref(false)
const activeCitation = ref<Citation>()
const previewVisible = ref(false)
const previewLoading = ref(false)
const previewDocument = ref<Awaited<ReturnType<typeof AssistantApi.document>>>()
const config = reactive<ModelConfig>({
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKeyConfigured: false,
  temperature: 0.2,
  maxTokens: 1024,
  contextTokens: 8192,
  enabled: false
})
const embedding = reactive({
  model: 'text-embedding-3-small',
  dimensions: 1536,
  enabled: false,
  connectionReady: false,
  configured: false,
  baseUrl: ''
})
const savedEmbedding = ref('')
const embeddingSaving = ref(false)
const embeddingTesting = ref(false)
const embeddingMessage = ref('')
const embeddingSuccess = ref(false)
const embeddingSelection = () =>
  JSON.stringify([embedding.model, embedding.dimensions, embedding.enabled])
const embeddingCanTest = computed(
  () =>
    embedding.configured &&
    embedding.enabled &&
    embeddingSelection() === savedEmbedding.value &&
    config.provider === 'openai' &&
    config.baseUrl === embedding.baseUrl &&
    !apiKey.value &&
    !clearApiKey.value
)
const apiKey = ref('')
const clearApiKey = ref(false)
const configLoading = ref(false)
const configSaving = ref(false)
const testing = ref(false)
const connectionMessage = ref('')
const connectionSuccess = ref(false)
watch(
  [
    () => embedding.model,
    () => embedding.dimensions,
    () => embedding.enabled,
    () => config.baseUrl,
    () => config.provider,
    apiKey,
    clearApiKey
  ],
  () => {
    embeddingMessage.value = ''
  }
)
const failure = (exception: unknown, fallback: string) => {
  error.value = exception instanceof Error ? exception.message : fallback
}
const cancelled = (exception: unknown) => exception === 'cancel' || exception === 'close'
async function scrollMessages() {
  await nextTick()
  messagesElement.value?.scrollTo({ top: messagesElement.value.scrollHeight, behavior: 'smooth' })
}
async function loadBases() {
  if (!canKnowledge && !canManage) return
  bases.value = await AssistantApi.bases()
  if (!bases.value.some((base) => base.id === knowledgeBaseId.value))
    knowledgeBaseId.value = bases.value[0]?.id
  selectedBases.value = selectedBases.value.filter((id) =>
    bases.value.some((base) => base.id === id)
  )
}
async function loadSessions() {
  if (canChat) sessions.value = await AssistantApi.sessions()
}
async function newSession() {
  if (sending.value) return
  ++evidenceRequest
  searching.value = false
  sessionId.value = undefined
  messages.value = []
  searchResult.value = undefined
  chatNotice.value = ''
  question.value = ''
}
async function openSession(id: number) {
  ++evidenceRequest
  searching.value = false
  historyLoading.value = true
  error.value = ''
  try {
    const session = await AssistantApi.session(id)
    sessionId.value = id
    messages.value = session.messages || []
    searchResult.value = undefined
    chatNotice.value = ''
    await scrollMessages()
  } catch (exception) {
    failure(exception, '会话加载失败')
  } finally {
    historyLoading.value = false
  }
}
async function renameSession() {
  if (!sessionId.value) return
  try {
    const result = await ElMessageBox.prompt('输入会话标题', '重命名', {
      inputValue: sessions.value.find((item) => item.id === sessionId.value)?.title || '',
      inputValidator: (value) => (!!value?.trim() && value.length <= 100) || '请输入1至100字标题'
    })
    await AssistantApi.renameSession(sessionId.value, result.value.trim())
    await loadSessions()
  } catch (exception) {
    if (!cancelled(exception)) failure(exception, '重命名失败')
  }
}
async function removeSession() {
  if (!sessionId.value) return
  try {
    await ElMessageBox.confirm('删除当前会话及消息记录？', '删除会话', { type: 'warning' })
    await AssistantApi.deleteSession(sessionId.value)
    await newSession()
    await loadSessions()
  } catch (exception) {
    if (!cancelled(exception)) failure(exception, '删除失败')
  }
}
async function sendKnowledgeQuestion(content: string, mode: RetrievalMode = retrievalMode.value) {
  if (!canChat || !canKnowledge || sending.value || searching.value) {
    throw new Error('当前知识会话暂时无法发送问题。')
  }
  sending.value = true
  error.value = ''
  searchResult.value = undefined
  try {
    if (!sessionId.value) sessionId.value = await AssistantApi.createSession()
    const target = sessionId.value
    const result = await AssistantApi.send(
      target,
      content,
      selectedBases.value,
      mode,
      retrievalHops.value,
      mode === 'GRAPH' ? 'LEXICAL' : documentStrategy.value
    )
    if (sessionId.value === target) {
      chatNotice.value = result.message
      const session = await AssistantApi.session(target)
      if (sessionId.value === target) messages.value = session.messages || []
    }
    await loadSessions()
    await scrollMessages()
    return result
  } finally {
    sending.value = false
  }
}
async function send() {
  if (!canChat || !canKnowledge || sending.value || searching.value || !question.value.trim())
    return
  try {
    await sendKnowledgeQuestion(question.value.trim())
    question.value = ''
  } catch (exception) {
    failure(exception, '发送失败，请重试')
  }
}
async function search() {
  if (!canKnowledge || searching.value || sending.value || !question.value.trim()) return
  if (question.value.length > 1000) return ElMessage.warning('独立检索问题最多1000字')
  const request = ++evidenceRequest
  searching.value = true
  searchResult.value = undefined
  error.value = ''
  try {
    const result = await searchEvidence({
      query: question.value.trim(),
      knowledgeBaseIds: [...selectedBases.value],
      mode: retrievalMode.value,
      hops: retrievalHops.value,
      documentStrategy: retrievalMode.value === 'GRAPH' ? 'LEXICAL' : documentStrategy.value,
      limit: 10
    })
    if (assistantDisposed || request !== evidenceRequest) return
    searchResult.value = result
    await scrollMessages()
  } catch (exception) {
    if (request === evidenceRequest) failure(exception, '检索失败')
  } finally {
    if (request === evidenceRequest) searching.value = false
  }
}
async function selectBase(id: number) {
  if (knowledgeBaseId.value !== id) documents.value = []
  knowledgeBaseId.value = id
  await loadDocuments()
}
const indexSummary = computed(() => {
  const published = documents.value.filter((doc) => doc.status === 'PUBLISHED')
  const ready = published.filter((doc) => doc.vectorUsable).length
  const pending = published.filter((doc) =>
    ['PENDING', 'PROCESSING'].includes(doc.vectorStatus)
  ).length
  return {
    published: published.length,
    ready,
    pending,
    needsAttention: published.length - ready - pending,
    removing: documents.value.filter((doc) => doc.vectorAction === 'REMOVE').length
  }
})
function searchCurrentBase() {
  if (!currentBase.value || sending.value) return
  selectedBases.value = [currentBase.value.id]
  retrievalMode.value = 'DOCUMENT'
  documentStrategy.value = 'SEMANTIC'
  tab.value = 'chat'
}
let documentPoll: ReturnType<typeof setTimeout> | undefined
let documentRequest = 0
let assistantDisposed = false
const vectorSubmitting = reactive(new Set<number>())
const vectorStatusText = (status: string, action?: string) => {
  if (action === 'REMOVE')
    return (
      { PENDING: '等待移除旧向量', PROCESSING: '正在移除旧向量', ERROR: '旧向量清理失败' }[
        status
      ] || '旧向量已失效'
    )
  return (
    {
      NOT_INDEXED: '尚未建立索引',
      READY: '待发布',
      PENDING: '等待入库',
      PROCESSING: '正在处理',
      INDEXED: '已入库',
      ERROR: '入库失败',
      WAITING_CONFIG: '等待模型配置',
      CONFIG_CHANGED: '模型配置已变更',
      STALE: '文件状态已变更',
      REMOVED: '已移除'
    }[status] || '尚未建立索引'
  )
}
async function rebuildDocumentVectors(document: KnowledgeDocument) {
  if (vectorSubmitting.has(document.id)) return
  vectorSubmitting.add(document.id)
  try {
    await AssistantApi.rebuildVectors(document.id, document.version)
    ElMessage.success('已提交文档向量入库任务')
    await loadDocuments()
  } catch (exception) {
    failure(exception, '向量任务提交失败')
  } finally {
    vectorSubmitting.delete(document.id)
  }
}
const graphStatusText = (status: string) =>
  ({
    NOT_INDEXED: '尚未建图',
    READY: '待发布',
    EMPTY: '未识别关系',
    PENDING: '等待同步',
    SYNCED: '已同步',
    ERROR: '同步失败',
    INVALID: '关系格式待检查',
    REMOVED: '已移除'
  })[status] || '尚未建图'
async function loadDocuments(background = false) {
  clearTimeout(documentPoll)
  const request = ++documentRequest,
    base = knowledgeBaseId.value
  if (!base) {
    documents.value = []
    documentsLoading.value = false
    return
  }
  if (!background) documentsLoading.value = true
  try {
    const result = await AssistantApi.documents(base)
    if (assistantDisposed || request !== documentRequest || base !== knowledgeBaseId.value) return
    documents.value = result
    if (
      tab.value === 'knowledge' &&
      result.some(
        (d) =>
          ['PENDING', 'PROCESSING'].includes(d.vectorStatus) ||
          (d.vectorStatus === 'ERROR' && (d.vectorAttempts < 5 || d.status === 'DRAFT')) ||
          d.graphStatus === 'PENDING' ||
          (d.graphStatus === 'ERROR' && (d.graphAttempts < 10 || d.status === 'DRAFT'))
      )
    ) {
      documentPoll = setTimeout(() => void loadDocuments(true), 3000)
    }
  } catch (exception) {
    if (request === documentRequest) failure(exception, '文档加载失败')
  } finally {
    if (request === documentRequest) documentsLoading.value = false
  }
}
async function rebuildDocumentGraph(document: KnowledgeDocument) {
  try {
    await AssistantApi.rebuildGraph(document.id)
    ElMessage.success(document.status === 'PUBLISHED' ? '已提交图谱同步任务' : '已重新解析草稿关系')
    await loadDocuments()
  } catch (exception) {
    failure(exception, '提交建图任务失败')
  }
}
watch(tab, (value) => {
  clearTimeout(documentPoll)
  if (value === 'knowledge') void loadDocuments()
})
onBeforeUnmount(() => {
  ++evidenceRequest
  assistantDisposed = true
  ++documentRequest
  clearTimeout(documentPoll)
})

function editBase(base?: KnowledgeBase) {
  baseError.value = ''
  baseForm.id = base?.id
  baseForm.name = base?.name || ''
  baseForm.description = base?.description || ''
  baseForm.libraryType = base?.libraryType || 'PERSONAL'
  baseForm.readerRoleIds = [...(base?.readerRoleIds || [])]
  if (canConfig.value) {
    rolesLoading.value = true
    void AssistantApi.baseRoles()
      .then((roles) => (baseRoles.value = roles))
      .catch((e) => failure(e, '角色列表加载失败'))
      .finally(() => (rolesLoading.value = false))
  }
  baseVisible.value = true
}
async function saveBase() {
  if (!baseForm.name.trim()) return ElMessage.warning('请输入知识库名称')
  baseSaving.value = true
  try {
    knowledgeBaseId.value = await AssistantApi.saveBase({ ...baseForm, name: baseForm.name.trim() })
    baseVisible.value = false
    await loadBases()
    await loadDocuments()
  } catch (exception) {
    baseError.value = exception instanceof Error ? exception.message : '知识库保存失败'
  } finally {
    baseSaving.value = false
  }
}
async function removeBase() {
  if (!knowledgeBaseId.value) return
  try {
    await ElMessageBox.confirm('知识库为空时才能删除，确认继续？', '删除知识库', {
      type: 'warning'
    })
    await AssistantApi.deleteBase(knowledgeBaseId.value)
    await loadBases()
    await loadDocuments()
  } catch (exception) {
    if (!cancelled(exception)) failure(exception, '删除失败')
  }
}
function openUpload(document?: KnowledgeDocument) {
  uploadTarget.value = document ? { ...document } : undefined
  uploadTitle.value = document?.title || ''
  uploadFile.value = undefined
  uploadError.value = ''
  uploadVisible.value = true
  void nextTick(() => uploadElement.value?.clearFiles())
}
async function showVersions(document: KnowledgeDocument) {
  versionsDocument.value = document
  versions.value = []
  versionsVisible.value = true
  versionsLoading.value = true
  try {
    versions.value = await AssistantApi.documentVersions(document.id)
  } catch (exception) {
    failure(exception, '版本记录加载失败')
  } finally {
    versionsLoading.value = false
  }
}
function fileChanged(file: UploadFile) {
  uploadError.value = ''
  if (!/\.(txt|md|csv|docx|pdf)$/i.test(file.name)) {
    uploadError.value = '请选择 TXT、MD、CSV、DOCX 或文本型 PDF 文件'
    uploadElement.value?.clearFiles()
    uploadFile.value = undefined
    return
  }
  if (file.size && file.size > 5 * 1024 * 1024) {
    uploadError.value = '文件不能超过5MB'
    ElMessage.warning(uploadError.value)
    uploadElement.value?.clearFiles()
    uploadFile.value = undefined
    return
  }
  uploadFile.value = file.raw
}
async function uploadDocument() {
  if (!knowledgeBaseId.value || !uploadFile.value) return
  uploading.value = true
  try {
    uploadError.value = ''
    const target = uploadTarget.value
    const result = target
      ? await AssistantApi.updateDocument(
          target.id,
          target.version,
          uploadTitle.value,
          uploadFile.value
        )
      : await AssistantApi.upload(knowledgeBaseId.value, uploadTitle.value, uploadFile.value)
    ElMessage.success(
      target
        ? '新版本已保存为草稿，旧版向量和图谱进入清理队列。请审核后重新发布。'
        : `解析完成，生成${result.chunkCount}个片段，请审核后发布`
    )
    uploadVisible.value = false
    uploadTitle.value = ''
    uploadFile.value = undefined
    uploadElement.value?.clearFiles()
    await loadBases()
    await loadDocuments()
  } catch (exception) {
    uploadError.value =
      exception instanceof Error ? exception.message : '文件更新或解析失败，请重试'
  } finally {
    uploading.value = false
  }
}
async function publishDocument(document: KnowledgeDocument) {
  try {
    await ElMessageBox.confirm(
      document.status === 'PUBLISHED'
        ? '撤回后立即退出新提问检索，旧向量失效；后台移除该文档的向量和图谱关系，历史引用快照保留。'
        : '确认已审核原文？发布后按知识库权限参与检索，并通过已配置的Embedding平台生成向量。',
      document.status === 'PUBLISHED' ? '撤回文档' : '发布文档'
    )
    await AssistantApi.publish(document.id, document.status !== 'PUBLISHED', document.version)
    ElMessage.success(
      document.status === 'PUBLISHED'
        ? '文档已撤回，旧向量已失效，后台继续清理'
        : '文档已发布，向量将后台处理'
    )
    await loadBases()
    await loadDocuments()
  } catch (exception) {
    if (!cancelled(exception)) failure(exception, '文档状态更新失败')
  }
}
async function removeDocument(document: KnowledgeDocument) {
  try {
    await ElMessageBox.confirm(
      `删除“${document.title}”及检索分块，并在后台移除其向量和图谱关系？历史会话引用快照保留。`,
      '删除文档',
      { type: 'warning' }
    )
    await AssistantApi.deleteDocument(document.id)
    ElMessage.success('文档已删除并退出检索，后台继续清理其向量和图谱关系')
    await loadBases()
    await loadDocuments()
  } catch (exception) {
    if (!cancelled(exception)) failure(exception, '删除文档失败')
  }
}
async function preview(id: number, version?: number) {
  previewLoading.value = true
  error.value = ''
  try {
    previewDocument.value = await AssistantApi.document(id, version)
    previewVisible.value = true
  } catch (exception) {
    failure(exception, '原文不存在、已撤回或无权访问')
    ElMessage.warning('当前原文不可访问；历史引用快照仍可核对')
  } finally {
    previewLoading.value = false
  }
}
function viewCitation(citation: Citation) {
  activeCitation.value = citation
  citationVisible.value = true
}
async function downloadDocument(
  document: Pick<KnowledgeDocument, 'id' | 'fileName'>,
  version?: number
) {
  try {
    const blob = await AssistantApi.download(document.id, version)
    const objectUrl = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = objectUrl
    link.download = document.fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (exception) {
    failure(exception, '文档下载失败')
  }
}
function changeProvider() {
  if (config.provider === 'ollama' && config.baseUrl === 'https://api.openai.com/v1')
    config.baseUrl = 'http://127.0.0.1:11434'
  else if (config.provider === 'openai' && config.baseUrl === 'http://127.0.0.1:11434')
    config.baseUrl = 'https://api.openai.com/v1'
}
async function saveConfig() {
  if (!canConfig.value || configSaving.value || embeddingTesting.value || embeddingSaving.value)
    return
  if (!config.model.trim() || !config.baseUrl.trim())
    return ElMessage.warning('请填写服务地址和实际模型名称')
  configSaving.value = true
  error.value = ''
  connectionMessage.value = ''
  try {
    const { apiKeyConfigured: _configured, ...settings } = config
    Object.assign(
      config,
      await AssistantApi.saveModelConfig({
        ...settings,
        apiKey: apiKey.value,
        clearApiKey: clearApiKey.value
      })
    )
    apiKey.value = ''
    clearApiKey.value = false
    modelStatus.value = await AssistantApi.status()
    const connection = await AssistantApi.embeddingConfig()
    embedding.connectionReady = connection.connectionReady
    embedding.configured = connection.configured
    embedding.baseUrl = connection.baseUrl
    embeddingMessage.value = ''
    ElMessage.success('配置已安全保存')
  } catch (exception) {
    failure(exception, '配置保存失败')
  } finally {
    configSaving.value = false
  }
}
async function testConfig() {
  if (!canConfig.value || testing.value || configSaving.value) return
  testing.value = true
  connectionMessage.value = ''
  try {
    const result = await AssistantApi.testModelConfig()
    connectionSuccess.value = true
    connectionMessage.value = result.message
  } catch (exception) {
    connectionSuccess.value = false
    connectionMessage.value =
      exception instanceof Error ? exception.message : '连接测试失败，请检查服务、模型名称和密钥'
  } finally {
    testing.value = false
  }
}
async function saveEmbeddingConfig() {
  if (!canConfig.value || embeddingSaving.value || embeddingTesting.value || configSaving.value)
    return
  embeddingSaving.value = true
  embeddingMessage.value = ''
  try {
    Object.assign(
      embedding,
      await AssistantApi.saveEmbeddingConfig({
        model: embedding.model,
        dimensions: embedding.dimensions,
        enabled: embedding.enabled
      })
    )
    savedEmbedding.value = embeddingSelection()
    ElMessage.success('Embedding配置已保存')
  } catch (exception) {
    embeddingSuccess.value = false
    embeddingMessage.value =
      exception instanceof Error ? exception.message : 'Embedding配置保存失败'
  } finally {
    embeddingSaving.value = false
  }
}
async function testEmbeddingConfig() {
  if (
    !canConfig.value ||
    embeddingTesting.value ||
    embeddingSaving.value ||
    configSaving.value ||
    !embeddingCanTest.value
  )
    return
  embeddingTesting.value = true
  embeddingMessage.value = ''
  try {
    const result = await AssistantApi.testEmbeddingConfig()
    embeddingSuccess.value = true
    embeddingMessage.value = result.message
  } catch (exception) {
    embeddingSuccess.value = false
    embeddingMessage.value =
      exception instanceof Error ? exception.message : 'Embedding连接测试失败'
  } finally {
    embeddingTesting.value = false
  }
}
onMounted(async () => {
  try {
    modelStatus.value = await AssistantApi.status()
    await Promise.all([loadBases(), loadSessions()])
    await loadDocuments()
    if (canConfig.value) {
      configLoading.value = true
      Object.assign(config, await AssistantApi.modelConfig())
      Object.assign(embedding, await AssistantApi.embeddingConfig())
      savedEmbedding.value = embeddingSelection()
    }
  } catch (exception) {
    failure(exception, '助手初始化失败')
  } finally {
    configLoading.value = false
  }
})
</script>

<style scoped>
/* Only this tab takes the remaining height in the application's scroll area. */
:global(.el-scrollbar__view:has(> section > .mes-assistant-page.is-graph)) {
  display: flex;
  flex-direction: column;
  height: 100%;
}
:global(.el-scrollbar__view > section:has(> .mes-assistant-page.is-graph)) {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0 !important;
  padding: 0;
}
.mes-assistant-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: 42px auto auto;
  min-width: 0;
  background: var(--el-bg-color);
}
.mes-assistant-page.is-graph {
  flex: 1 1 0;
  min-height: 0;
  grid-template-rows: 42px auto minmax(0, 1fr);
}
.mes-assistant-page > .assistant-tabs {
  display: contents;
  --el-tabs-header-height: 42px;
}
.mes-assistant-page :deep(.assistant-tabs > .el-tabs__header) {
  grid-area: 1 / 1;
  min-width: 0;
  height: 42px;
  margin: 0;
  padding-inline: 10px 4px;
}
.mes-assistant-page :deep(.assistant-tabs > .el-tabs__content) {
  grid-area: 3 / 1 / 4 / -1;
  min-width: 0;
  min-height: 0;
}
.mes-assistant-page:not(.is-graph) :deep(.assistant-tabs > .el-tabs__content) {
  padding: 10px;
}
.mes-assistant-page :deep(#pane-graph) {
  height: 100%;
}
.model-status {
  grid-area: 1 / 2;
  align-self: center;
  justify-self: end;
  margin-inline: 6px 10px;
  max-width: min(40vw, 26em);
  white-space: nowrap;
}
.model-status :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.mes-assistant-page > .assistant-alert {
  grid-area: 2 / 1 / 3 / -1;
}

.assistant-chat-toolbar,
.assistant-document-heading,
.assistant-composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.assistant-document-heading h3 {
  margin: 0 0 6px;
}

.assistant-document-heading p,
.assistant-welcome p,
.assistant-search-result p,
.assistant-field-help {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.assistant-alert {
  margin: 12px 0;
}

.assistant-layout,
.assistant-knowledge-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 580px;
  gap: 20px;
}

.assistant-without-sidebar {
  grid-template-columns: minmax(0, 1fr);
}

.assistant-sidebar {
  min-width: 0;
  padding-right: 16px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.assistant-sidebar > .el-button {
  width: 100%;
  margin-bottom: 16px;
}

.assistant-session-list {
  max-height: 600px;
  overflow: auto;
}

.assistant-session {
  display: flex;
  width: 100%;
  padding: 12px;
  margin-bottom: 7px;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  flex-direction: column;
  gap: 7px;
}

.assistant-session span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-session small {
  color: var(--el-text-color-secondary);
}

.assistant-session.active,
.assistant-session:hover {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}

.assistant-chat {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}

.assistant-chat-toolbar {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.works-knowledge-settings {
  display: grid;
  gap: 14px;
}
.works-knowledge-settings :deep(label) {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.assistant-messages {
  height: 480px;
  padding: 8px 12px 16px 0;
  overflow: auto;
}

.assistant-welcome {
  padding: 80px 24px;
  text-align: center;
}

.assistant-message {
  padding: 16px;
  margin: 12px 0;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.assistant-message.user {
  margin-left: 25px;
  background: var(--el-color-primary-light-9);
}

.assistant-message-label {
  display: flex;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  justify-content: space-between;
  gap: 8px;
}

.assistant-message-label small {
  font-weight: 400;
}

.assistant-message-content {
  padding: 10px 0;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.assistant-citations {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.assistant-citations button,
.assistant-search-card {
  display: flex;
  padding: 10px 12px;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  flex-direction: column;
  gap: 7px;
}

.assistant-citations span,
.assistant-search-card small {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.assistant-search-card {
  width: 100%;
  margin: 10px 0;
}

.assistant-search-card span {
  max-height: 180px;
  overflow: hidden;
  line-height: 1.7;
  white-space: pre-wrap;
}

.assistant-composer-actions {
  margin-top: 10px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.assistant-composer-actions > span {
  min-width: 180px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1;
}

.assistant-documents {
  min-width: 0;
}

.assistant-document-heading {
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.assistant-index-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  margin-bottom: 12px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.assistant-index-overview p {
  margin: 6px 0 0;
  color: var(--el-text-color-regular);
}

.assistant-index-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assistant-index-actions :deep(.el-button) {
  min-height: 44px;
  margin: 0;
}

.assistant-document-table {
  margin-top: 16px;
}

.assistant-config {
  max-width: 850px;
  padding: 10px 0 20px;
}

.assistant-config-form {
  margin-top: 24px;
}

.assistant-field-help {
  width: 100%;
  margin: 6px 0;
  line-height: 1.7;
}

.assistant-upload-title {
  margin-bottom: 16px;
}

.assistant-source-text {
  padding: 16px;
  font-family: inherit;
  line-height: 1.8;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  overflow-wrap: anywhere;
}

.assistant-full-text {
  max-height: 62vh;
  overflow: auto;
}

.assistant-hash {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}

.assistant-chunk {
  padding: 16px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

@media (width <= 960px) {
  .assistant-layout,
  .assistant-knowledge-layout {
    grid-template-columns: 1fr;
  }

  .assistant-sidebar {
    max-height: 200px;
    padding: 0 0 12px;
    overflow: auto;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .assistant-messages {
    height: 450px;
  }
}
</style>
