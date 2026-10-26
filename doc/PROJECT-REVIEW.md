# STRGO Web 整仓 review

> 当前状态：下文初次审查结果保留为历史；本轮功能补齐已修复其跨平台失败、NEXUS同步和GPU调度缺口，并建立实际通过的Linux CI。最新范围、证据及外部验收见本文末尾「功能补齐复核」，不要将初次失败计数当作当前结果。

日期：2026-10-23（Asia/Shanghai）。初始基准：`5dd523aaac795bed31b099b1c59f40dd89feee98`；审查期间远端新增 AI 空间提交 `77f75a75fff6c131a56391f23a42e81cf48a1981`，已合入并补充审查和回归。本记录包含随后修复的验证结果。

## 结论与范围

审查发现并修复了 DREAMS 同步可能丢失原目标内容的风险，以及统一仓库迁移后的路径、Windows 构建和回归测试问题。当前结果支持继续开发；完整 Linux 后端回归及真实生产环境验收仍未完成，不能据此宣称全仓验收全绿。新增 AI 空间已检查身份/模块授权、管理二次验证、预算预占、任务恢复、上游地址和音频边界；本轮未复现其他需要立即修复的严重问题。

已盘点初始版本的 542 个跟踪文件，并补查远端 AI 提交后共 563 个跟踪文件的结构，覆盖根主站、共享 Python 后端、六个独立应用、构建测试脚本与部署配置。关键源码审查聚焦会话与权限、外部请求、文件存储、任务幂等、DREAMS 集成、终端卷归属和沙箱参数。没有逐行审计随仓库打包的第三方库，也没有进行线上渗透测试或依赖漏洞数据库审计。

## 已修复问题

| 优先级 | 触发条件与影响 | 修复与证据 |
| --- | --- | --- |
| P1 | DREAMS 原同步流程先删除目标，再检查 `chapterPath`；不完整或不兼容的构建可使已有目标内容丢失。目标还指向迁移前的 `apps/strgo-homepage/`，主站实际副本不会更新。 | [同步脚本](../apps/dreams/scripts/sync-strgo.mjs) 固定到当前仓库 `src/dreams/`，先在临时目录复制、转换和校验，再保留旧目录并替换；替换失败尝试恢复旧目录。[隔离回归](../tests/monorepo.test.mjs) 验证八章路径展平、正确目标和无效配置保留旧内容。 |
| P2 | 在统一仓库构建独立应用后，根预览仍访问相邻旧工程，三条空间入口可返回 404。 | [预览服务](../scripts/preview.mjs) 改读 `apps/polyverse/dist`、`apps/meow/dist`、`apps/swarmera/dist`；隔离临时仓库中验证三条路由均能读取各自页面。 |
| P2 | POLYVERSE 将文件 URL 的 `pathname` 当本地路径，Windows 盘符路径解析错误，无法构建。 | [构建脚本](../apps/polyverse/scripts/build.mjs) 使用 `fileURLToPath`；本轮在 Windows 实际生成 14 个独立页面。 |
| P2 | 根场景测试只移除 LF 导入语句；CRLF 检出时三个生命周期测试在执行前报语法错误。 | [场景测试](../tests/scene-runtime.test.mjs) 同时处理 CRLF/LF；最终根 Node 76/76 通过，包含三个新增迁移回归及后续 AI 契约测试。 |
| P2 | SWARMERA 离线部署测试读取本机 `/etc/nginx`、旧 `/root/strgo-homepage`，并依赖未准备的 manifest，普通检出无法完成测试。 | [部署测试](../apps/swarmera/tests/deployment.test.mjs) 使用临时 Nginx 样例并实际生成 manifest，主站路径从当前仓库定位；17 项应用回归通过。 |
| P3 | 首页浏览器测试没有确保计数卡片进入可视区，并固定等待 1.4 秒后断言动画结束；本轮出现 `98.7` 与 `99.9` 的失败。 | [浏览器测试](../tests/browser-check.mjs) 滚动到计数卡片后等待目标值，并设定超时，不修改页面动画；桌面、手机与减少动效回归通过。 |

## 实际验证

环境为 Windows PowerShell、Node.js `24.19.0`、Python `3.12.14`。基于现有依赖，使用 pnpm `11.25.0`、不生成锁文件并禁用安装脚本，补齐根目录新增的 PostCSS 以及 DREAMS/POLYVERSE 的依赖。初次依赖获取遇到证书链问题，启用系统 CA 后安装成功；没有关闭 TLS 校验，没有修改依赖清单或锁文件。本轮没有证明 Linux 下的完整 `npm ci` 与生产安装过程。

| 模块 | 执行范围 | 结果 |
| --- | --- | --- |
| 主站 | `build.py --require-vendor` | 生产模式静态构建通过 |
| 主站 Node | `node --test tests/*.test.mjs` | 76/76 通过，包含新增 AI 空间 11 项测试与迁移回归 |
| 根 Python 完整回归 | 合并 AI 提交后 `unittest discover -s tests -p 'test_*.py' -v` | 171 项：134 通过、9 断言失败、28 错误；155.7 秒完成，详情见下节 |
| 关键后端子集 | `test_local_studio`、`test_comfy_worker`、`test_workflow_http`、`test_forum_service`、`test_terminal_account` | 41/41 通过；属于上述完整回归的子集，不重复累计 |
| Workflow 浏览器 | 真实 Chrome、模拟 API、320/390/768/1440 宽度 | 管理员登录、成员拒绝、工作流切换、参考图压缩、离线限制、CSRF、提交和退出通过 |
| DREAMS | 独立构建、acceptance、reflections | 构建及两组验收通过；包括 16 种场景组合、交互、反射相机与失败清理 |
| POLYVERSE | 独立构建、math、state、DOM | 构建通过；10 项数学/场景、3 项状态及 DOM 流程通过 |
| MEOW | 独立构建、全部 Node 测试 | 构建通过；29/32 通过，3 项因 Bash/符号链接环境要求失败 |
| SWARMERA | 独立构建、core、scene、runtime、deployment | 构建通过，17/17 通过 |
| NEXUS | 独立构建、interactions | 构建通过，23 项交互/几何检查通过 |
| 终端 Node | UI、workspace | 38/38 通过 |
| 终端 Python | `unittest discover -s apps/terminal/tests` | 30/31 通过，1 项在 Windows 缺少 `os.fchmod` |
| 终端浏览器 | 真实 Chrome、模拟账号和连接协议，五种尺寸 | 聊天输入、密码和终端切换，以及三窗口、草稿、后台输出、恢复和退出通过 |
| 首页浏览器 | 真实 Chrome、桌面、手机、减少动效与交互 | 最终通过；包含菜单、计数、场景暂停、作品弹窗、实验室和联系操作 |
| 项目技能 | skill-creator 的 `quick_validate.py` | 两个技能的命名、frontmatter 和内容结构校验通过 |

原始日志保留在本地忽略目录 `artifacts/review/`；Workflow 与终端浏览器截图保存在各自 `artifacts/` 下。表内结果来自本轮实际执行，没有沿用历史文档中的测试数字。

AI 空间还单独执行 `tests.test_ai_workspace`：49 项，39 通过、5 断言失败、5 错误，是完整回归的子集。失败链路涉及 Windows 不提供 `os.O_DIRECTORY` 的暂存/删除日志同步，继而影响音乐保存、状态流转和 GPU 锁释放；不能当作已通过的音乐端到端验收。

## 待完成项和维护风险

1. **Linux 完整回归仍需补验。** 合并后根 Python 有 9 个断言失败和 28 个错误。主要触发点为 Windows 缺少 Bash、`os.O_DIRECTORY` 和部分符号链接能力，暂存失败还使后续生图/音乐状态断言失败；另有测试临时 SQLite 文件未关闭导致的清理错误，以及 DREAMS canonical 断言使用 Windows 反斜杠。后者位于 [构建测试](../tests/test_build.py) 的路径拼接，产物 canonical 本身为正确的 `/`。MEOW 的三个部署测试和终端 `fchmod` 检查也需 Linux 验证。不能把这些结果改写成全部通过，也不能据此推断 Linux 生产服务出现相同故障。
2. **NEXUS 存在两份源码的维护风险。** 本轮比较 `apps/nexus/src/` 与 `src/nexus/src/` 的同名模块内容一致；以后仅修改独立工程不会自动更新主站副本。DREAMS 的 `config.js` 差异则包含集成时预期的 `chapterPath` 转换。
3. **文档仍含历史路径和状态。** 已新增集中索引、当前开发指南并修正 DREAMS 部署命令；历史交付文件保留原文，避免把过去的发布状态当作当前证据。后续按模块整理时可逐步归档。
4. **持续集成仍缺统一入口。** 基准仓库没有跟踪的 `.github/` 工作流。建议在 Linux 中先跑通各模块独立构建、根 Node/Python 与终端 Rust 检查，再建立 CI；构建和测试依赖关系见开发指南。
5. **AI 与 Workflow 的 GPU 调度尚未统一。** 现有 AI 文档明确限定两条队列不得同时使用同一 GPU。当前默认模型未启用，未复现实际争用；部署前必须落实硬件或运行时隔离，不能以单队列锁测试通过代替跨队列验收。

本轮未执行 Rust/Cargo 编译、Docker 实际隔离与 WebSocket 后端端到端、真实 GPU/收费模型、远端 Nginx/systemd、备份恢复演练或生产发布。浏览器中模拟 API 的通过只证明对应前端流程，不代表服务端或真实设备行为已全部验收。

## 新增长期入口

- [开发文档索引](README.md)、[架构](ARCHITECTURE.md)、[开发指南](DEVELOPMENT.md)。
- [Codex 技能索引](../codex/README.md) 与开发、review 两个技能。
- 根 [AGENTS.md](../AGENTS.md) 将后续会话路由到这些资料；技能按仓库路径加载，未修改用户全局技能安装。
- AI 设计、实现与验收文档从 `docs/ai/` 移到 `doc/ai/`，已同步修正入口链接。

原有未跟踪的 `docs/design/homepage-v3/` 为会话开始前已有的设计稿，本次未修改或纳入提交。

## 2026-10-23 功能补齐复核

基准为 `e1f0f5c`，业务代码至 `36f7a26`，内容浏览器验收修复为 `1c3bf62`。完整需求、优先级、外部依赖及逐项提交对应关系见 [执行清单](FEATURE-BACKLOG.md)。F01–F13已完成仓库内交付，新增后台入口为 `/admin/`；尚未部署生产。

本轮修复和实现了跨平台持久写入、账号/邀请码/社区/额度/审计统一后台、AI与Workflow跨队列GPU互斥及确认卸载后释放、私有AI历史分页和对话搜索、原子NEXUS同步、Linux CI及清洁检出安装。实际浏览器又发现并修复三个应用的预览路径、DREAMS首屏页脚以及三处搜索输入Escape问题。账号最终复核复现了在途登录/改密可绕过会话撤销的问题，现以写事务、账号版本和当前会话复验阻止旧请求签发会话，并保留3条回归。

| 验证范围 | 实际结果与限制 |
| --- | --- |
| Windows最终根检查 | `node scripts/verify.mjs --root`：生产构建通过、Node91项通过、Python204项中200通过/4项平台跳过；包含新增账号16项与GPU竞争5项 |
| Linux构建与回归 | [`36f7a26` CI](https://github.com/jimmonster/strgo-web/actions/runs/39828010953)：web/terminal两个job成功；根Node91/Python204（含F12）、终端Node38/Python31/Rust20项全通过；独立应用构建/回归、Bash部署与集成检查通过 |
| 全站后台 | 真实临时HTTP/SQLite、4种宽度×7页面及管理操作通过；前端8项通过；后台不返回成员凭据、私人提示词/对话/音频正文 |
| AI | 真实临时HTTP/SQLite、5种宽度×7路由，106条任务及40条作品/会话分页、搜索、SSE通过；文本与音频为隔离测试夹具 |
| 五个3D应用 | DREAMS/POLYVERSE/MEOW/NEXUS/SWARMERA真实Chrome通过各自浏览器脚本，含直接访问/刷新、搜索/设置及交互；本机SwiftShader，不作为真实GPU性能数据 |
| 终端 | 本机两个浏览器脚本、5种尺寸通过；模拟账号与连接协议，不能替代Docker/SSH实际连接；Linux CI已编译Rust并通过20项 |
| 作者作品内容 | 早期两次在复制提示检查超时；F13补齐返回首页后的交互就绪等待与失败诊断后，375/768/1440宽度连续两轮通过，每轮18张截图 |
| 发布与状态 | 未发布、未调用收费模型、未操作本机运行中的ComfyUI；原设计稿未修改或提交 |

以上有重叠用例，不累加为全仓独立测试数量。原始结果位于本机忽略的 `artifacts/` 及各应用 `artifacts/`；截图是实际浏览器输出，软件渲染和模拟协议的范围已在各模块验收记录注明。

仍待外部验收：供应商密钥/价格/许可证、真实GPU模型装卸与推理、Linux Docker/SSH和生产备份回滚演练、实体手机/Safari/触屏性能、真实作者材料与首页新设计选择。仓库内检查不能证明这些外部链路已就绪；详细处理条件见清单E01–E08。

## 2026-10-26 PR #2 合并前复核

范围：[PR #2](https://github.com/jimmonster/strgo-web/pull/2)，main 基准 `2e365ed7b66914d294eba4e1b51c8b98525c34f0`，待审业务提交 `856a049086195615c36fdb43adffd78848083baa`。用户确认仅合入该 PR；旧功能分支的两个终端中文输入/SSH 提交不在本次范围。

审查覆盖本 PR 的社区后端、增量表结构、帖子编辑版本冲突、评论幂等与删除权限、收件人通知隔离、前端私有数据清理、共享导航及各应用构建集成；视觉改动结合实际浏览器抽查。未发现未解决的阻断合并问题。此次审查不代表全仓逐行审计或生产验收。

| 发现 | 触发与影响 | 修复和证据 |
| --- | --- | --- |
| P3：终端主题检查把 CRLF 误判为 token 过期 | Windows 使用 `core.autocrlf=true` 检出正确的终端 CSS 后，`node scripts/sync-terminal-theme.mjs --check` 比较 LF 生成块与 CRLF 源码而失败。 | [主题脚本](../scripts/sync-terminal-theme.mjs) 比较前统一换行。[隔离回归](../tests/monorepo.test.mjs) 在修复前实际失败，修复后覆盖 LF/CRLF 无写入检查、真正过期 token 拒绝和同步后通过。 |

本轮实际验证环境：Windows、Node.js 24.22.1、Python 3.12.14、实际 Chrome。使用既有依赖，未修改依赖锁文件。原始日志和截图保存于本地忽略目录 `artifacts/review/`。

| 验证 | 结果与边界 |
| --- | --- |
| 统一验证 | `node scripts/verify.mjs` 所有执行项通过：正式根构建、五个独立应用构建及对应回归、NEXUS 源码一致性、终端资源/UI/工作区/Python检查。 |
| 最终根 Node | 修复后重新执行 `node --test tests/*.test.mjs`，107/107 通过。 |
| 根 Python | 226 项：222 通过、4 项 Windows 平台跳过；含讨论权限、并发、幂等、分页、迁移与备份回归。 |
| 终端 Python | 31 项：30 通过、1 项 POSIX 权限检查跳过；本机未运行 Linux Rust 服务。 |
| AI 浏览器 | 实际 Chrome + 临时 HTTP/SQLite，完整历史分页、搜索、流式响应及 5 种宽度 × 7 路由通过。 |
| 社区浏览器 | 两个隔离账号、实际 HTTP/SQLite：评论纯文本显示、回复通知、作者编辑后保留评论、会员隐藏管理导航、账号隔离收藏、单次 Esc 关闭及 375px 无横向溢出通过。 |
| 主题与差异 | 修复后终端 token `--check` 和 `git diff --check` 通过；构建生成的资源变更不纳入审查提交。 |
| Linux CI | 业务提交 `856a049` 的 [PR CI](https://github.com/jimmonster/strgo-web/actions/runs/40305325531) web/terminal 两个 job 成功；覆盖 Linux 部署辅助与终端锁定 Rust 测试。补充修复提交的最终 CI 需以 PR 当前 head 的检查记录为准。 |

Windows 跳过的 Bash 部署、符号链接与 POSIX 权限、Rust 项不记作本机通过。此次未发布生产，未调用真实模型/GPU，未操作真实 SSH/Docker 或实体手机。生产更新仍须同步静态文件与账号 API，并重建终端资源；发布边界沿用原部署文档。

## 2026-10-26 合并后 CI 收尾

基准：`577106346a907a52516b5b6b697ce045082fbe40`（PR #2 合并提交）。[合并后 CI](https://github.com/jimmonster/strgo-web/actions/runs/40335147966) 的生产构建、根回归、独立应用和终端检查通过，后台浏览器步骤失败：恢复成员账号后，全页 `getByRole('button', { name: '停用账号', exact: true })` 同时匹配成员按钮与管理员自身的禁用按钮，触发 Playwright strict mode violation。

修复 `tests/admin-browser.mjs`：停用、恢复及恢复后的等待均以目标成员的稳定 `data-user` 和 `data-action="status"` 定位，再等待对应的精确文案；账号列表更新或重排后仍检查同一成员。补充检查成员可操作，以及管理员自身的停用按钮在整个状态切换过程中始终禁用。

本机 Linux、Node.js 24.22.1、Python 3.12.14，Python 使用隔离环境安装项目要求的依赖，实际验证：

- `npm run build:production` 通过。
- `npm test`：根 Node 107 项、Python 226 项全部通过，无跳过；包括后台前端 8 项、后端 16 项，子集不重复累计。
- `node --check tests/admin-browser.mjs`、`git diff --check` 通过。

本机 Chrome 下载包无法解压，未将本机浏览器验收记为通过。修复提交的真实 HTTP/SQLite 浏览器、独立应用及终端完整结果以该提交关联的 [GitHub Actions](https://github.com/jimmonster/strgo-web/actions/workflows/verify.yml) 为准；原始本机回归日志位于忽略目录 `artifacts/review/ci-followup-root.log`。生产及外部链路继续按清单 E01–E08 验收。

## 2026-10-26：ECS 统一命令

基准 `61cd68f`。按用户要求提供简单好记的 `strgo deploy`：一次安装命令链接后，可从任意目录拉取 main，再准备主站、三个独立空间与已安装终端的构建，备份账号配置、密钥、源码和加密数据库，复用原发布脚本逐模块更新。环境、更新范围、任务维护窗口、数据备份边界及短暂中断见根 [部署说明](../DEPLOYMENT.md)。`strgo check` 不拉取代码、构建或发布；`--skip-terminal` 明确保留终端版本。

新增离线回归 11 项通过，覆盖环境文件不执行 shell、存储/来源配置边界、三类队列未完成任务阻断、只读旧数据库及缺失数据库不被创建、终端清单与真实 sha256sum 校验/篡改拒绝、命令安装幂等及同名程序保留、任意目录执行、先拉取后启动新版程序、本地修改/拉取失败/未推送提交阻断与只读检查。Bash 语法与差异检查通过。完整 Linux CI 以本提交关联运行记录为准。

未连接用户 ECS，未执行生产发布或真实终端构建。这里的验证覆盖发布入口和离线边界；既有模块发布回滚及 Docker/SSH 探针由用户在 ECS 运行命令时执行，整轮更新不是跨模块的整体事务。
