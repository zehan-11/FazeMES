<template>
  <KnowledgeLaunchOverlay v-if="moduleIntro && tab !== 'graph'" @done="moduleIntro = false" />
  <section
    class="mes-assistant-page"
    :class="{
      'is-graph': tab === 'graph',
      'is-works': tab === 'works',
      'is-embedded': embedded,
      'fm-panel': !embedded && tab !== 'graph',
      'fm-optical-rim': !embedded && tab === 'knowledge'
    }"
  >
    <header class="assistant-nav"
      ><div class="nav-scroll">
        <GlassSegmented v-model="tab" label="助手功能" :options="navigationChoices" />
      </div>
      <el-tag
        class="model-status"
        :type="modelStatus?.configured ? 'success' : 'info'"
        :title="modelLabel"
        :aria-label="modelLabel"
      >
        {{
          modelStatus?.configured ? modelStatus.model : modelStatus ? '模型未配置' : '模型状态未知'
        }}
      </el-tag></header
    >
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="assistant-alert"
    />
    <div class="assistant-tabs">
      <FanWorksWorkbench
        v-if="tab === 'works'"
        :visible="!embedded || visible"
        :prefer-knowledge="fromLibrary"
        :ask-knowledge="sendKnowledgeQuestion"
        :knowledge-scope="{
          knowledgeBaseIds: selectedBases,
          mode: retrievalMode,
          documentStrategy,
          hops: retrievalHops
        }"
        @knowledge-settings="worksScopeOpen = true"
      />
      <section
        v-if="!embedded && (canKnowledge || canManage) && tab === 'graph'"
        class="graph-pane"
        aria-label="知识图谱"
      >
        <KnowledgeGraph ref="graphView" @open-document="preview" />
      </section>
      <section v-if="canBusiness" v-show="tab === 'business'" aria-label="业务 Agent">
        <BusinessAssistant
          :active="tab === 'business' && (!embedded || visible)"
          :compact="embedded"
          :initial-id="requestedTab === 'business' ? requestedSession : undefined"
          @conversation="businessId = $event"
          @navigate="openBusinessAnalysis"
        />
      </section>
      <section v-if="canChat || canKnowledge" v-show="tab === 'chat'" aria-label="知识助手">
        <div class="assistant-layout" :class="{ 'assistant-without-sidebar': !canChat }">
          <aside class="assistant-sidebar" v-if="canChat && !embedded">
            <el-button type="primary" plain :disabled="sending" @click="newSession"
              >新建会话</el-button
            >
            <div v-if="sessionId" class="session-tools">
              <el-button text size="small" :disabled="sending" @click="renameSession"
                >重命名</el-button
              >
              <el-button text size="small" :disabled="sending" @click="removeSession"
                >删除会话</el-button
              >
            </div>
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
            <el-alert
              v-if="modelStatus && !modelStatus.configured"
              title="模型未配置：可以检索真实文档和查看引用，不会生成或伪造模型答复。管理员可在“模型配置”接入服务。"
              type="info"
              :closable="false"
              show-icon
            />
            <div class="assistant-messages" ref="messagesElement" v-loading="historyLoading">
              <div
                v-if="!messages.length && !searchResult && !historyLoading"
                class="assistant-welcome"
              >
                <h3>从知识库里找答案</h3>
                <p>选择一个问题，或输入设备、故障和工艺名称。答案可回到原文核对。</p>
                <PromptGrid :items="knowledgePrompts" :disabled="sending" @pick="usePrompt" />
              </div>
              <article
                v-for="(item, messageIndex) in visibleMessages"
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
                  class="journey-pill"
                  round
                  size="small"
                  @click="openMessageJourney(item, messageIndex + firstMessage)"
                  ><i aria-hidden="true"></i>查看问答流程预览</el-button
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
              <el-input
                ref="questionInput"
                v-model="question"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 5 }"
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
              <div class="composer-toolbar">
                <el-popover trigger="click" :width="308" placement="top-start">
                  <template #reference
                    ><button
                      class="tool-pill"
                      type="button"
                      :disabled="sending"
                      aria-label="检索模式"
                      >模式 ·
                      {{ retrievalChoices.find((x) => x.value === retrievalMode)?.label }} ⌄</button
                    ></template
                  >
                  <GlassSegmented
                    v-model="retrievalMode"
                    label="检索模式"
                    :options="retrievalChoices"
                    :disabled="sending"
                  />
                  <el-select
                    v-if="retrievalMode !== 'DOCUMENT'"
                    v-model="retrievalHops"
                    class="mt-8px"
                    aria-label="图谱检索跳数"
                    :disabled="sending"
                  >
                    <el-option label="一跳关系" :value="1" /><el-option
                      label="两跳关系"
                      :value="2"
                    />
                  </el-select>
                </el-popover>
                <el-popover trigger="click" :width="275" placement="top-start">
                  <template #reference
                    ><button
                      class="tool-pill"
                      type="button"
                      :disabled="sending"
                      aria-label="知识库范围"
                      >范围 ·
                      {{ selectedBases.length ? selectedBases.length + ' 个库' : '全部可见' }}
                      ⌄</button
                    ></template
                  >
                  <el-select
                    v-model="selectedBases"
                    multiple
                    clearable
                    collapse-tags
                    placeholder="全部可访问的已发布知识库"
                    aria-label="检索知识库范围"
                  >
                    <el-option
                      v-for="base in bases"
                      :key="base.id"
                      :label="$catalogLabel(base.name)"
                      :value="base.id"
                    />
                  </el-select>
                </el-popover>
                <el-popover
                  v-if="retrievalMode !== 'GRAPH'"
                  trigger="click"
                  :width="230"
                  placement="top-start"
                >
                  <template #reference
                    ><button
                      class="tool-pill"
                      type="button"
                      :disabled="sending"
                      aria-label="文档检索策略"
                      >策略 · {{ strategyLabels[documentStrategy] }} ⌄</button
                    ></template
                  >
                  <GlassSegmented
                    v-model="documentStrategy"
                    label="文档检索策略"
                    :options="strategyChoices"
                    :disabled="sending"
                  />
                  <p class="popover-note"
                    >综合和语义策略会调用已配置的 Embedding 服务处理本次问题。</p
                  >
                </el-popover>
                <el-popover trigger="click" :width="240" placement="top-start">
                  <template #reference
                    ><button class="tool-pill" type="button" aria-label="历史轮次显示范围"
                      >历史 · {{ historyRounds ? historyRounds + ' 轮' : '全部' }} ⌄</button
                    ></template
                  >
                  <GlassSegmented
                    v-model="historyRounds"
                    label="历史轮次显示范围"
                    :options="historyChoices"
                  />
                  <p class="popover-note">选择对话中显示的轮次。模型上下文由服务端管理。</p>
                </el-popover>
                <div class="composer-submit">
                  <el-button
                    v-if="canKnowledge"
                    size="small"
                    :loading="searching"
                    :disabled="sending || !question.trim() || question.length > 1000"
                    @click="search"
                    >检索证据</el-button
                  >
                  <el-button
                    v-if="canChat && canKnowledge"
                    size="small"
                    type="primary"
                    :loading="sending"
                    :disabled="!question.trim() || searching || historyLoading"
                    @click="send"
                    >发送提问</el-button
                  >
                </div>
              </div>
              <small v-if="chatNotice" class="composer-notice" role="status">{{
                chatNotice
              }}</small>
            </div>
            <div v-if="!embedded" class="chat-extras">
              <DifyAssistant v-if="canChat && canKnowledge" @journey="openJourney" />
              <el-button text size="small" @click="openJourney()">预览问答流程</el-button>
            </div>
            <el-button
              v-else-if="sessionId"
              text
              size="small"
              :disabled="sending"
              @click="newSession"
              >新建问答</el-button
            >
          </main>
        </div>
      </section>

      <section
        v-if="!embedded && (canKnowledge || canManage)"
        v-show="tab === 'knowledge'"
        aria-label="RAG知识库"
      >
        <div class="library">
          <div class="library-toolbar">
            <div class="library-scope"
              ><el-icon aria-hidden="true"><Lock /></el-icon>
              <GlassSegmented
                v-model="libraryScope"
                label="知识库访问范围"
                :options="scopeChoices"
              />
            </div>
            <div class="library-tools">
              <GlassSegmented v-model="libraryView" label="文档视图" :options="viewChoices" />
              <el-button :icon="Share" @click="tab = 'graph'">知识图谱</el-button>
              <el-button
                v-if="currentBase?.canManage"
                type="primary"
                v-magnetic
                :icon="Upload"
                @click="openUpload()"
                >上传文档</el-button
              >
            </div>
          </div>
          <div class="library-base">
            <el-select
              :model-value="knowledgeBaseId"
              aria-label="当前知识库"
              placeholder="选择知识库"
              :disabled="!scopedBases.length"
              @change="selectBase"
            >
              <el-option
                v-for="base in scopedBases"
                :key="base.id"
                :label="$catalogLabel(base.name)"
                :value="base.id"
              />
            </el-select>
            <span v-if="currentBase" class="base-meta"
              >{{ currentBase.canManage ? '可维护' : '只读' }} ·
              {{ currentBase.documentCount }} 份文档</span
            >
            <el-button v-if="libraryScope === 'PERSONAL' || canConfig" text @click="editBase()"
              >新建知识库</el-button
            >
            <el-dropdown v-if="currentBase?.canManage" trigger="click">
              <el-button text aria-label="知识库管理">管理</el-button>
              <template #dropdown
                ><el-dropdown-menu>
                  <el-dropdown-item @click="editBase(currentBase)">编辑知识库</el-dropdown-item>
                  <el-dropdown-item @click="removeBase">删除知识库</el-dropdown-item>
                </el-dropdown-menu></template
              >
            </el-dropdown>
          </div>
          <template v-if="currentBase">
            <p v-if="currentBase.description" class="base-description">{{
              $catalogLabel(currentBase.description)
            }}</p>
            <div class="library-coverage" role="status">
              <span
                ><strong>{{ indexSummary.ready }} / {{ indexSummary.published }}</strong>
                份已发布文档可语义检索
                <template v-if="indexSummary.pending">
                  · {{ indexSummary.pending }} 份处理中</template
                >
                <template v-if="indexSummary.needsAttention">
                  · {{ indexSummary.needsAttention }} 份待索引</template
                >
                <template v-if="indexSummary.removing">
                  · {{ indexSummary.removing }} 份待清理</template
                >
              </span>
              <div
                ><el-button text size="small" :loading="documentsLoading" @click="loadDocuments()"
                  >刷新状态</el-button
                >
                <el-button
                  v-if="canKnowledge"
                  link
                  type="primary"
                  :disabled="sending || !indexSummary.published"
                  @click="searchCurrentBase"
                  >用 Agent 查询此库</el-button
                ></div
              >
            </div>
            <DocumentCollection
              :documents="documents"
              :view="libraryView"
              :manage="currentBase.canManage"
              :loading="documentsLoading"
              :submitting="vectorSubmitting"
              @preview="preview"
              @action="runDocumentAction"
            />
            <details class="library-guide"
              ><summary>支持的文件格式与建图说明</summary>
              <p
                >支持 TXT、MD、CSV、DOCX 和文本型 PDF，单份最多 5 MB。扫描 PDF 需先
                OCR。审核发布后，系统会处理向量并从中文手册中识别部件、故障原因和处理措施。</p
              >
              <p
                >例如「电机由轴承和转子组成」。也支持箭头关系及「源实体、关系、目标实体」三列
                CSV。无法识别时会显示「未识别关系」。</p
              >
              <a href="/templates/knowledge-relations.md" download>下载关系文档模板</a>
            </details>
          </template>
          <el-empty
            v-else
            :description="
              libraryScope === 'PERSONAL' ? '还没有个人知识库' : '暂无获授权的企业规则库'
            "
            :image-size="72"
          />
        </div>
      </section>

      <section v-if="!embedded && canConfig" v-show="tab === 'config'" aria-label="模型配置">
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
      </section>
    </div>
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
  <el-dialog
    :append-to-body="embedded"
    v-model="citationVisible"
    title="可追溯引用"
    width="min(820px, 92vw)"
  >
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
    <FanWorksReplay v-if="journeyVisible && journeyData" :record="journeyData" />
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
  <el-dialog :append-to-body="embedded" v-model="previewVisible" title="原文与分块" width="85%"
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
import GlassSegmented from '@/components/GlassSegmented.vue'
import { Lock, Share, Upload } from '@element-plus/icons-vue'
import SuccessMark from '@/components/SuccessMark.vue'
import KnowledgeScopeControls from './KnowledgeScopeControls.vue'
import DocumentCollection from './DocumentCollection.vue'
import PromptGrid from './PromptGrid.vue'
import type { DocumentAction } from './DocumentMenu.vue'
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
import BusinessAssistant from '@/views/mes/insight/BusinessAssistant.vue'

const FanWorksWorkbench = defineAsyncComponent(() => import('./FanWorksWorkbench.vue'))
const FanWorksReplay = defineAsyncComponent(() => import('./FanWorksReplay.vue'))
const KnowledgeGraph = defineAsyncComponent(() => import('@/views/mes/graph/KnowledgeGraph.vue'))

defineOptions({ name: 'MesAssistant' })
const props = withDefaults(defineProps<{ embedded?: boolean; visible?: boolean }>(), {
  embedded: false,
  visible: true
})

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
  else moduleIntro.value = !props.embedded && tab.value !== 'works' && !reducedMotion.matches
})

const canChat = checkPermi(['mes:assistant:chat'])
const canKnowledge = checkPermi(['mes:assistant:knowledge'])
const canManage = checkPermi(['mes:assistant:manage'])
const canConfig = computed(() => checkPermi(['mes:assistant:config']))
const canBusiness = computed(
  () => checkPermi(['mes:insight:query']) && checkPermi(['mes:insight:chat'])
)
const assistantRoute = useRoute()
const navigationChoices = [
  { value: 'works', label: 'Agent 协同', show: canBusiness.value || canKnowledge || canChat },
  { value: 'graph', label: '知识图谱', show: !props.embedded && (canKnowledge || canManage) },
  { value: 'business', label: '业务 Agent', show: canBusiness.value },
  { value: 'chat', label: '知识助手', show: canKnowledge || (!props.embedded && canChat) },
  { value: 'knowledge', label: 'RAG 知识库', show: !props.embedded && (canKnowledge || canManage) },
  { value: 'config', label: '模型配置', show: !props.embedded && canConfig.value }
].filter((item) => item.show)
const requestedTab = props.embedded ? 'works' : assistantRoute.query.tab
const hasTab = (value: unknown): value is string =>
  navigationChoices.some((item) => item.value === value)
const tab = ref(hasTab(requestedTab) ? requestedTab : (navigationChoices[0]?.value ?? 'config'))
watch(
  () => assistantRoute.query.tab,
  (value) => {
    if (!props.embedded && assistantRoute.path === '/mes/assistant' && hasTab(value))
      tab.value = value
  }
)

const emit = defineEmits<{ context: [tab: string, sessionId?: number] }>()
const sessionParam = Number(assistantRoute.query.session)
const requestedSession =
  !props.embedded && Number.isSafeInteger(sessionParam) && sessionParam > 0
    ? sessionParam
    : undefined
const businessId = ref<number>()

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const moduleIntro = ref(
  !props.embedded && tab.value !== 'graph' && tab.value !== 'works' && !reducedMotion.matches
)
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
    : modelStatus.value
      ? '模型尚未配置'
      : '模型状态未知'
)
const bases = ref<KnowledgeBase[]>([])
const fromLibrary = ref(false)
const worksScopeOpen = ref(false)
const selectedBases = ref<number[]>([])
const libraryScope = ref<KnowledgeBase['libraryType']>('PERSONAL')
const scopeChoices = [
  { value: 'PERSONAL', label: '个人隐私库（仅本人可见）' },
  { value: 'RULES', label: '企业规则库（按角色授权）' }
] as const
const viewChoices = [
  { value: 'cards', label: '卡片' },
  { value: 'list', label: '列表' }
] as const
const libraryView = ref<'cards' | 'list'>('cards')
const scopedBases = computed(() =>
  bases.value.filter((base) => base.libraryType === libraryScope.value)
)
const knowledgeBaseId = ref<number>()
function alignBase() {
  if (!scopedBases.value.some((base) => base.id === knowledgeBaseId.value)) {
    documents.value = []
    knowledgeBaseId.value = scopedBases.value[0]?.id
  }
}
function runDocumentAction(command: DocumentAction, doc: KnowledgeDocument) {
  const handlers = {
    download: downloadDocument,
    update: openUpload,
    versions: showVersions,
    publish: publishDocument,
    vector: rebuildDocumentVectors,
    graph: rebuildDocumentGraph,
    delete: removeDocument
  }
  if (command === 'download' || currentBase.value?.canManage) void handlers[command](doc)
}
const currentBase = computed(() => bases.value.find((base) => base.id === knowledgeBaseId.value))
const sessions = ref<AssistantSession[]>([])
const sessionId = ref<number>()
watch(
  [tab, () => (tab.value === 'business' ? businessId.value : sessionId.value)],
  ([activeTab, id]) => emit('context', activeTab, id),
  { immediate: true }
)
let sessionRequest = 0
const messages = ref<AssistantMessage[]>([])
const question = ref('')
const questionInput = ref<{ focus: () => void }>()
function usePrompt(value: string) {
  question.value = value
  questionInput.value?.focus()
}
const knowledgePrompts = [
  {
    title: '点检异常怎么处理？',
    detail: '查找点检规范和处置顺序',
    question: '设备点检发现异常时，应如何处理？'
  },
  {
    title: '设备由哪些部件组成？',
    detail: '沿设备关系核对部件',
    question: '手册中的电风扇由哪些部件组成？'
  },
  {
    title: '轴承为什么会异响？',
    detail: '追溯故障原因与依据',
    question: '轴承异响有哪些可能原因？'
  },
  {
    title: '检修前要做哪些准备？',
    detail: '核对安全条件和操作要求',
    question: '检修设备前有哪些安全准备要求？'
  },
  {
    title: '如何判断检验合格？',
    detail: '定位质量标准的原文',
    question: '质量文件中有哪些检验合格条件？'
  },
  {
    title: '润滑维护有哪些要求？',
    detail: '查找周期、方法与出处',
    question: '设备手册对润滑维护有哪些要求？'
  }
]
const chatNotice = ref('')
const historyRounds = ref(0)
const historyChoices = [
  { value: 3, label: '3 轮' },
  { value: 6, label: '6 轮' },
  { value: 0, label: '全部' }
]
const firstMessage = computed(() => {
  if (!historyRounds.value) return 0
  let remaining = historyRounds.value
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user' && --remaining === 0) return i
  }
  return 0
})
const visibleMessages = computed(() => messages.value.slice(firstMessage.value))
const strategyChoices = [
  { value: 'LEXICAL', label: '关键词' },
  { value: 'SEMANTIC', label: '语义' },
  { value: 'COMBINED', label: '综合' }
] as const
const sending = ref(false)
const searching = ref(false)
const historyLoading = ref(false)
const searchResult = ref<EvidenceSearchResult>()
const modeLabels = { DOCUMENT: '文档问答', GRAPH: '图谱问答', HYBRID: '混合问答' }
const retrievalChoices = [
  { value: 'DOCUMENT', label: '文档 RAG' },
  { value: 'GRAPH', label: '图谱 GraphRAG' },
  { value: 'HYBRID', label: '混合' }
] as const
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
  alignBase()
  selectedBases.value = selectedBases.value.filter((id) =>
    bases.value.some((base) => base.id === id)
  )
}
async function loadSessions() {
  if (canChat) sessions.value = await AssistantApi.sessions()
}
async function newSession() {
  if (sending.value) return
  ++sessionRequest
  historyLoading.value = false
  ++evidenceRequest
  searching.value = false
  sessionId.value = undefined
  messages.value = []
  searchResult.value = undefined
  chatNotice.value = ''
  question.value = ''
}
async function openSession(id: number) {
  const request = ++sessionRequest
  ++evidenceRequest
  searching.value = false
  historyLoading.value = true
  error.value = ''
  try {
    const session = await AssistantApi.session(id)
    if (request !== sessionRequest) return
    sessionId.value = id
    messages.value = session.messages || []
    searchResult.value = undefined
    chatNotice.value = ''
    await scrollMessages()
  } catch (exception) {
    if (request === sessionRequest) failure(exception, '会话加载失败')
  } finally {
    if (request === sessionRequest) historyLoading.value = false
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
  if (!canChat || !canKnowledge || historyLoading.value || sending.value || searching.value) {
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
    if (!props.embedded) await loadSessions()
    await scrollMessages()
    return result
  } finally {
    sending.value = false
  }
}
async function send() {
  if (
    !canChat ||
    !canKnowledge ||
    historyLoading.value ||
    sending.value ||
    searching.value ||
    !question.value.trim()
  )
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
watch(
  libraryScope,
  () => {
    alignBase()
    void loadDocuments()
  },
  { flush: 'sync' }
)
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
  documentStrategy.value = indexSummary.value.ready ? 'COMBINED' : 'LEXICAL'
  fromLibrary.value = true
  tab.value = 'works'
}
let documentPoll: ReturnType<typeof setTimeout> | undefined
let documentRequest = 0
let assistantDisposed = false
const vectorSubmitting = reactive(new Set<number>())
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
  ++sessionRequest
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
  baseForm.libraryType = base?.libraryType || (canConfig.value ? libraryScope.value : 'PERSONAL')
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
    const savedId = await AssistantApi.saveBase({ ...baseForm, name: baseForm.name.trim() })
    libraryScope.value = baseForm.libraryType
    if (knowledgeBaseId.value !== savedId) documents.value = []
    knowledgeBaseId.value = savedId
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
    ElMessage.success({
      message: target
        ? '新版本已保存为草稿，旧版向量和图谱进入清理队列。请审核后重新发布。'
        : `解析完成，生成${result.chunkCount}个片段，请审核后发布`,
      icon: SuccessMark,
      customClass: 'fm-success-toast'
    })
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
    await Promise.all([
      checkPermi(['mes:assistant:query'])
        ? AssistantApi.status().then((status) => {
            modelStatus.value = status
          })
        : undefined,
      loadBases(),
      props.embedded ? undefined : loadSessions()
    ])
    if (canChat && (tab.value === 'chat' || tab.value === 'works') && requestedSession)
      await openSession(requestedSession)
    if (!props.embedded && tab.value === 'knowledge') await loadDocuments()
    if (!props.embedded && canConfig.value) {
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
  min-width: 0;
  color: var(--fm-text);
}
.mes-assistant-page.is-graph {
  background-color: #020618;
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  flex-direction: column;
}
.is-graph .assistant-tabs {
  flex: 1 1 0;
  min-height: 0;
}
.graph-pane {
  height: 100%;
}
.assistant-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 5px 12px;
  border-bottom: 1px solid var(--fm-divider);
  background: var(--fm-card);
}
.nav-scroll {
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-scroll > .fm-segmented {
  width: max-content;
  max-width: none;
}
.nav-scroll :deep(.fm-segmented__option span) {
  padding: 4px 10px;
  white-space: nowrap;
}
.model-status {
  min-width: 42px;
  max-width: min(25%, 15em);
}
.model-status :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assistant-alert {
  margin: 4px 0;
}
.mes-assistant-page:not(.is-graph) > .assistant-tabs {
  padding: clamp(10px, 1.5vw, 22px);
}
.works-knowledge-settings {
  display: grid;
  gap: 12px;
}
.is-works.mes-assistant-page > .assistant-tabs {
  padding: 0;
}
.assistant-layout {
  display: grid;
  grid-template-columns: clamp(150px, 16%, 220px) minmax(0, 1fr);
  gap: 18px;
}
.assistant-without-sidebar,
.is-embedded .assistant-layout {
  grid-template-columns: minmax(0, 1fr);
}
.assistant-sidebar {
  min-width: 0;
  padding-right: 14px;
  border-right: 1px solid var(--fm-line);
}
.assistant-sidebar > .el-button {
  width: 100%;
  margin-bottom: 10px;
}
.session-tools,
.chat-extras {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.session-tools {
  margin-bottom: 7px;
}
.library {
  display: grid;
  min-width: 0;
  gap: 13px;
}
.library-toolbar,
.library-tools,
.library-scope,
.library-base,
.library-coverage {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.library-toolbar,
.library-coverage {
  justify-content: space-between;
}
.library-tools .el-button,
.library-base .el-button {
  margin: 0;
}
.library-scope {
  color: var(--fm-blue-ink);
  flex-wrap: nowrap;
}
.library-base .el-select {
  width: min(260px, 100%);
}
.base-meta,
.base-description,
.library-guide,
.library-coverage {
  font-size: 13px;
  color: var(--fm-secondary);
}
.base-description {
  margin: -4px 0 0;
  overflow-wrap: anywhere;
}
.library-coverage {
  padding: 7px 12px;
  border: 1px solid var(--fm-line);
  border-radius: 10px;
  background: var(--fm-slot);
}
.library-coverage strong {
  color: var(--fm-blue-ink);
  font-variant-numeric: tabular-nums;
}
.library-guide {
  border-top: 1px solid var(--fm-divider);
  padding-top: 12px;
  line-height: 1.65;
}
.library-guide summary {
  cursor: pointer;
  width: fit-content;
}
.library-guide a {
  color: var(--fm-blue-ink);
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

.assistant-messages {
  min-height: 190px;
  height: clamp(265px, 49dvh, 640px);
  padding: 2px 5px 4px 0;
  overflow: auto;
  scrollbar-gutter: stable;
}
.assistant-welcome {
  max-width: 1200px;
  margin-inline: auto;
  padding: 13px 0 12px;
}
.assistant-welcome h3 {
  margin: 0 0 6px;
  font-size: 22px;
  line-height: 1.4;
}
.assistant-welcome p {
  margin: 0 0 16px;
  color: var(--fm-secondary);
  line-height: 1.6;
}
.assistant-composer {
  padding: 9px 12px;
  border: 1px solid var(--fm-strong-line);
  border-radius: 16px;
  background: var(--fm-overlay);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    var(--fm-shadow);
  backdrop-filter: blur(14px);
}
.assistant-composer:focus-within {
  border-color: var(--fm-focus);
}
.assistant-composer :deep(.el-textarea__inner) {
  background: transparent;
  box-shadow: none;
  padding: 7px 5px;
}
.composer-toolbar,
.composer-submit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.composer-toolbar {
  padding-top: 7px;
}
.composer-submit {
  margin-left: auto;
}
.composer-submit .el-button {
  margin: 0;
}
.tool-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 3px 9px;
  font: inherit;
  font-size: 12px;
  color: var(--fm-secondary);
  border: 1px solid var(--fm-line);
  border-radius: 999px;
  background: var(--fm-slot);
  cursor: pointer;
}
.tool-pill:hover,
.tool-pill:focus-visible {
  color: var(--fm-blue-ink);
  border-color: var(--fm-focus);
}
.popover-note,
.composer-notice {
  display: block;
  margin: 7px 0 0;
  font-size: 12px;
  color: var(--fm-muted);
  line-height: 1.6;
}
.chat-extras {
  justify-content: flex-end;
}
.chat-extras :deep(.el-button) {
  min-height: 24px;
  height: auto;
  padding: 4px 8px;
  font-size: 12px;
}
.journey-pill {
  gap: 6px;
  margin-top: 9px;
  color: var(--fm-tone-success);
}
.journey-pill i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--fm-tone-success);
  animation: journey-pulse 2.6s ease-out infinite;
}
@keyframes journey-pulse {
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--fm-tone-success) 15%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .journey-pill i {
    animation: none;
  }
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

.assistant-citations button {
  border-radius: 12px;
  background: var(--fm-slot);
  border-color: var(--fm-line);
}
.assistant-citations button:hover {
  border-color: var(--fm-focus);
  color: var(--fm-blue-ink);
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

.is-embedded .assistant-nav {
  padding: 4px 1px 7px;
  background: transparent;
}
.is-embedded.mes-assistant-page > .assistant-tabs {
  padding: 9px 0 0;
}
.is-embedded .assistant-messages {
  height: clamp(130px, 32dvh, 290px);
  min-height: 0;
}
.is-embedded .assistant-welcome {
  padding: 2px 0 8px;
}
.is-embedded .assistant-welcome h3 {
  font-size: 17px;
}
.is-embedded .assistant-welcome p {
  margin-bottom: 8px;
  font-size: 12px;
}
.is-embedded .assistant-chat {
  gap: 7px;
}
@media (max-width: 850px) {
  .assistant-layout {
    grid-template-columns: 1fr;
  }
  .assistant-sidebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 0 6px;
    border: 0;
    border-bottom: 1px solid var(--fm-line);
  }
  .assistant-sidebar > .el-button {
    width: auto;
    margin: 0;
  }
  .assistant-session-list {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    max-height: 64px;
  }
  .assistant-session {
    flex: none;
    max-width: 145px;
    padding: 4px 8px;
    margin: 0;
  }
  .assistant-session-list :deep(.el-empty) {
    display: none;
  }
  .assistant-messages {
    height: clamp(245px, 42dvh, 470px);
  }
}
@media (max-width: 550px) {
  .library-toolbar {
    align-items: stretch;
  }
  .library-scope {
    width: 100%;
  }
  .library-tools {
    gap: 5px;
  }
  .library-scope :deep(.fm-segmented__option span) {
    font-size: 12px;
    padding: 5px 6px;
  }
  .assistant-nav {
    gap: 4px;
    padding-inline: 5px;
  }
  .model-status {
    max-width: 74px;
  }
  .composer-submit {
    margin-left: 0;
  }
}
</style>
