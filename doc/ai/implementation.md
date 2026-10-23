# 实现映射与扩展契约

2026-10-23 门户接入：`/ai/tasks/` 和 `/ai/assets/` 现在使用 [统一门户视图](../hub/design-v3.1.md)，聚合当前账号的图像与 AI 记录；现有 `/api/ai/v1/tasks`、`/assets` 和操作接口继续保留。音乐页仍包含原音频管理与参数复用。新增 [聚合接口](../hub/implementation.md) 不更改本文件的原 AI API 契约。

## 宿主适配记录（P00）

| 项目 | 本仓库实际选择 |
| --- | --- |
| 来源 | `jimmonster/strgo-web`，基于更新后的 main `5dd523a`（保留新增 ComfyUI 本地创作台） |
| 前端 | 原生 ES Modules + Web Component；沿用 Python 静态构建 |
| 后端 | `image_service.app.Service` 中的独立 `AIService`；沿用 Python HTTP 服务 |
| 身份 | `users.id`、scrypt 密码、共用根路径 HttpOnly Cookie、原有 CSRF |
| 数据库 | 原 SQLite；新增 `ai_` 表，`BEGIN IMMEDIATE` + 条件更新实现原子预占/领取 |
| 对象 | 原有 DiskStorage / OSSStorage；`ai/audio/<owner>/<task>` 私有路径 |
| 入口 | 静态 `/ai/`、`/admin/ai/`；接口 `/api/ai/v1/`，仍监听 8092 |
| 配置 | 原 Fernet 主密钥；在线 Key、节点凭据与任务配置快照仅服务端解密 |
| 预发布 | 当前环境仅完成离线/HTTP 契约验证；没有已配置的真实预发布实例 |
| 恢复 | 原加密数据库备份 + 私有文件 + 暂存音频 + 最新独立删除日志 + 原密钥 |

这份映射替代设计 v1.0 中尚未确定宿主时的框架默认值。原设计的权限、所有权、预占和明确确认原则保持。SQLite 只适合共用同一持久化数据库的服务实例；不要将不同 ECS 的本地数据库当成分布式调度器。

## 文件职责

| 文件 | 负责内容 |
| --- | --- |
| `src/ai-workspace/app.js` | 工作区导航、音乐表单、作品、任务、权限、后台 |
| `src/ai-workspace/client.js` | CSRF、UUIDv7、报价/提交、SSE 游标恢复、账号切换事件 |
| `src/ai-workspace/assistant.js` | 完整对话与侧栏的共用组件；安全文字渲染、建议预览、应用 |
| `src/image-playground/assistant-integration.js` | 现有生图工作台的独立接入；只传当前文字 |
| `image_service/ai_schema.py` | 追加式数据结构和默认停用的模型连接 |
| `image_service/ai_security.py` | 文字/音乐校验、幂等键、时间周期、TOTP |
| `image_service/ai_providers.py` | 公网 HTTPS 固定 IP 传输、私网白名单、四种适配器、音频校验 |
| `image_service/ai_service.py` | 统一接口、权限、事务、资源互斥、Worker、清理与结算 |
| `image_service/ai_cli.py` | 显式初始化、MFA 恢复、删除重放、已核实资源锁释放 |

设计稿的深石墨背景、薄边框、薄荷绿强调色、固定左导航以及音乐三栏/对话双栏/后台表格已映射到响应式 CSS。音乐封面使用代码原生 SVG 的流动金属视觉；当前没有音乐封面生成服务。页面的用量、模型状态、成员和作品来自接口，生产环境没有硬编码的已完成歌曲。

## 模块接入

所有模块复用同一 `AIClient` 与 `<strgo-assistant>`，不新建聊天 API。Web Component 内部样式隔离，不要求宿主引入特定框架。

```html
<strgo-assistant id="assistant"></strgo-assistant>
```

```js
import { AIClient } from '/ai/static/client.js';
import '/ai/static/assistant.js';

const client = new AIClient();
await client.refreshSession();
const assistant = document.querySelector('#assistant');
await assistant.configure({
  client,
  scope: 'music',                 // global / music / image
  formId: savedForm.id,
  revision: savedForm.revision,
  conversationId: existingConversationId,
  beforeSend: async () => saveCurrentForm(),
  fullPage: false,
});

assistant.addEventListener('strgo:draft-applied', event => {
  renderForm(event.detail);        // 应用文字和参数；这里不调用生成接口
});
```

`beforeSend` 也会在应用建议前执行，以先保存尚未提交的人工修改。若版本变化，服务端拒绝旧建议，防止覆盖未保存输入。`fullPage: true` 用于独立对话页。普通对话不要绑定音乐/生图表单。

| 事件 | 宿主处理 |
| --- | --- |
| `strgo:auth-required` | 显示统一账号登录 |
| `strgo:conversation-created` | 保存对话 ID 到当前页面 URL |
| `strgo:draft-applied` | 更新宿主表单与版本；不发起生成 |
| `strgo:text-selected` | 用户明确确认的文字；当前用于生图提示词 |
| `strgo:run-completed` | 刷新历史与用量 |
| `strgo:collapse` | 宿主折叠侧栏 |
| `AIClient` 的 `auth-changed` | 清理页面状态；工作区重新加载，生图关闭旧助手 |

目前后端明确注册 `global/music/image` 三种 scope。增加视频等模块时，按以下顺序扩展，不能仅向前端传任意 scope：

1. 在服务端注册目标 scope 和严格表单 schema；所有资源绑定既有 owner。
2. 将该 scope 的表单快照加入本轮 `normalize_input`，禁止自动读取其他 scope。
3. 若需要结构化建议，增加该模块独立的补丁 schema、差异预览与乐观版本检查。
4. 宿主监听应用事件，更新自己的表单；生成仍通过该模块自己的报价与确认流程。
5. 编写跨 scope 隔离、非法字段、过期版本和“应用不生成”契约测试。

## 接口约定

普通 JSON 响应为 `{data, request_id}`；错误为 `{error:{code,message}, request_id}`。音频为二进制，事件为 SSE。写请求必须来自站点 Origin 并携带 `X-CSRF-Token`；提交 run/job 还需 `Idempotency-Key: UUIDv7`。

| 路径（相对 `/api/ai/v1`） | 方法 | 用途 |
| --- | --- | --- |
| `/session` | GET | 共用用户、CSRF、模块/模型权限、额度、二次验证状态 |
| `/auth/login`, `/auth/register`, `/auth/logout` | POST | 委托原有账号系统；注册仍需邀请码 |
| `/models`, `/usage` | GET | 已授权模型的公开信息、日额度与私有空间 |
| `/access-requests` | GET / POST | 查看自己的申请、提交权限申请 |
| `/forms`, `/forms/{id}` | POST / GET / PUT / PATCH | 模块表单；更新须传 `revision` |
| `/conversations` | GET / POST | 按 scope 列表、创建独立或绑定表单的对话 |
| `/conversations/{id}` | GET / DELETE | 所有者消息/运行/建议快照、删除正文 |
| `/conversations/{id}/transfer` | POST | message_id + 原消息中的 selection，创建新音乐草稿 |
| `/quotes/chat`, `/quotes/music` | POST | 五分钟、单次使用、绑定输入和模型版本的报价 |
| `/runs`, `/music/jobs` | POST | 事务创建对话运行或音乐任务及所有预占 |
| `/tasks`, `/music/jobs` | GET | 所有者最近任务 |
| `/tasks/{id}` | GET | 任务快照；音乐包含原始参数快照 |
| `/tasks/{id}/events` | GET | 按 `after_seq` / `Last-Event-ID` 重放持久化事件 |
| `/tasks/{id}/cancel` | POST | 幂等取消；已派发任务等待明确结果 |
| `/drafts/{id}`, `/drafts/{id}/apply` | GET / POST | 读取差异、按 `revision` 应用一次 |
| `/assets`, `/assets/{id}` | GET / DELETE | 私有音频列表与删除 |
| `/assets/{id}/audio` | GET | Cookie 鉴权播放/Range；`?download=1` 下载 |
| `/admin/mfa/setup`, `/admin/mfa/verify` | POST | 密码确认后绑定、一次性动态口令二次验证 |
| `/admin/models`, `/admin/models/{id}`, `/{id}/check` | GET / PUT / POST | 配置、版本、启停、非生成式连接检查 |
| `/admin/members`, `/admin/members/{id}` | GET / PUT | 模块/模型/额度/到期日与停用 |
| `/admin/nodes`, `/admin/nodes/{id}` | GET / POST / PUT | 精确私网节点登记与排空 |
| `/admin/budgets` | GET / PUT | 按币种的日/月预算及已记账、预占值 |
| `/admin/requests`, `/admin/requests/{id}` | GET / PUT | 申请审核；通过时原子授予模块和所选模型 |
| `/admin/audit` | GET | 不含正文与密钥的元数据日志 |
| `/admin/reconciliation`, `/admin/reconciliation/{id}` | GET / PUT | 暂记成本与供应商实际账单核对 |

首版列表最多返回最近 100 条；大规模长期作品检索与游标分页属于后续扩展项。需要更长记录时应先增加游标分页，不应提高响应大小上限或开放全员查询。

音乐报价请求：

```json
{"model_id":"ace-step","form_id":"<32位ID>","revision":3,"local_only":true}
```

确认后提交相同输入，额外增加 `quote_id`，使用固定 UUIDv7 请求键。网络失败保留原请求与键重试；同键返回原任务，同键不同输入返回409。未知上游结果不自动重新 POST。

对话报价请求：

```json
{"model_id":"ollama","conversation_id":"<32位ID>","content":"优化当前副歌","mode":"music_draft","form_revision":3,"local_only":true}
```

`mode` 仅 `chat/music_draft`。普通对话不传 `form_revision`。`local_only` 由服务端检查且绑定到报价，不能通过替换模型绕过。对话输出不超过2048 tokens；历史按保守 UTF-8 字节上界裁剪，给输出预留空间，不自动纳入失败、停止或中断的轮次。

## 任务与费用收尾

音乐：`QUEUED → DISPATCHING → RUNNING → SAVING → SUCCEEDED`。同步二进制供应商会直接从派发进入保存。取消进入 `CANCEL_REQUESTED`；未知结果进入 `RECONCILING`，禁止重发。

对话：`QUEUED → DISPATCHING → RUNNING → SUCCEEDED`，停止/异常明确进入 `CANCELLED/INTERRUPTED/FAILED`，保存部分输出。所有终态不可回退。

创建任务与用户额度、存储和预算预占在同一事务中。结算检查唯一 reservation 标记，按提交时的北京时间周期释放预占并记账。聊天已派发计一次，音乐仅成功计申请秒数；供应商成本与用户额度分开。在线音乐或缺少可信 usage 的对话按上限暂记，管理员用账单核对；实际超过预占会照实记账并自动停用该模型。

私有音频先写加密暂存、校验格式/时长，再保存到自有私有对象。保存故障重试同一文件；崩溃后发现暂存文件可直接恢复。删除意图独立于数据库快照并加密保存，清理失败继续重试。

## 明确的适配限制

- 本次没有额外部署分布式网关/节点 agent。固定 IP、私网 ACL、服务凭据与中央资源锁组成部署边界；租约超时不抢锁。未知节点必须先确认停机再人工释放。
- 若同一硬件需要多个调度系统共享，先增加节点代理、fencing token 验证和 GPU 就绪/卸载协议，再开放多方调度。当前中央锁不能管理站外的直接调用。
- ACE-Step 的轮询按官方 `release_task/query_result` 及 `result` JSON 字符串兼容处理，只接受同一节点的 `/v1/audio?path=` 结果。
- DeepSeek 使用 Chat Completions SSE；其他兼容供应商必须真实验证 usage、终止标记、输出上限和价格上界，不能只凭接口名称标为已验收。
- 当前先提供四个可配置连接槽；多连接 CRUD、更多 scope、游标分页和跨供应商计价规则应按新需求逐步扩展。

现有 `WORKFLOW.md` 所述 ComfyUI 创作台使用独立任务队列。若与 AI 节点共用同一 GPU，当前版本必须错峰运行或使用不同硬件；开通共用硬件前应将该队列接入统一资源锁/节点代理。不要仅设置两个界面的资源组名称就假定已有跨队列互斥。
