# 论坛 Markdown、图片与 PDF

适用入口：主站 /forum/。更新日期：2026-11-04。功能沿用现有会员账号、帖子编辑权限和版本冲突检测；前端和账号服务需要一起更新。

## 使用范围

- 发帖和编辑帖子都有 Markdown 工具栏：标题、粗体、斜体、列表、引用、代码块和链接；展开预览后随输入更新。详情支持 GFM 表格、任务列表、代码和图片。
- 导入 UTF-8 的 .md 或 .markdown 文件会替换正文；最多 40 KB、10000 字。标题为空时从首个一级标题或文件名推导。失败保留原草稿。
- 编辑器可导出当前正文；帖子详情可导出带帖子标题的 Markdown。导出文件保留会员附件链接，不打包附件字节；需要登录后读取附件，图片和 PDF 可分别下载。
- “图片 / PDF”上传并在光标处插入 PNG、JPEG、WebP 图片或 PDF。图片说明、链接顺序和替换图片都可通过正文编辑；更新帖子时继续校验 revision，冲突保留输入。
- PDF 点击预览后按需加载本地 PDF.js，支持上一页、下一页、收起和原文件下载。逐页绘制到 canvas，不嵌入 PDF 活动文档，也不执行 PDF 脚本或表单动作。损坏、加密或当前浏览器不支持的文件可下载原文件处理。
- 固定界面文案支持简体中文、繁体中文、英语、日语和韩语；帖子正文、代码、图片说明及输入值保留作者原文。导入文档中的相对路径或外部图片需要另行上传插入。

## 附件权限与持久化

每个附件最多 5 MiB，每篇帖子最多引用 12 个，每位会员总量 100 MiB；每位会员五分钟最多 30 次上传请求。Base64 和 JSON 总量仍在现有 7 MiB HTTP / Nginx 限制内，不需要新增代理端口或放宽请求限制。

Store 启动时自动创建 forum_attachments 表和索引，旧帖子正文、评论与账号继续保留。文件内容使用现有 Fernet 密钥加密存入 SQLite，随现有加密数据库备份与恢复；无需生图云存储或模型密钥。附件会增加数据库和备份体积。

上传先生成仅作者可读的草稿附件。发帖或修改正文时，在同一事务中检查附件归属并绑定到帖子；不能占用他人的草稿或把已绑定附件再次绑定到另一篇帖子。提交失败或 revision 冲突不会消耗草稿附件。相同 request_id 的重复上传返回原附件，内容不一致则返回 409。

发布后仅登录会员可读。移除正文中的附件引用、删除帖子或通过全站后台删除帖子会清理对应附件；旧链接返回 404。未发布附件 24 小时后不可访问或绑定，同一会员下次上传时清理过期草稿。退出登录或切换账号会清空编辑预览、终止 PDF 读取和释放文档渲染资源，迟到的上传响应不会写回其他账号的草稿。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | /api/image/forum/attachments | 共享会话、同源 Origin 和 CSRF；JSON 字段 name、mime、data（Base64）、request_id（32 位十六进制） |
| GET | /api/image/forum/attachments/:id | 草稿作者或已发布帖子的登录会员；返回原文件字节 |
| GET | /api/image/forum/attachments/:id?download=1 | 原文件下载，保留 UTF-8 文件名 |

文件类型同时检查扩展名、声明 MIME 和文件头；PDF 还需包含结束标记。响应沿用 private/no-store、nosniff、same-origin 保护；PDF 按附件下载并附加隔离 CSP。

## 源码和构建

前端：[editor.js](../src/forum/editor.js)、[markdown.js](../src/forum/markdown.js)、[pdf-preview.js](../src/forum/pdf-preview.js)。后端：[forum_attachments.py](../image_service/forum_attachments.py)，帖子绑定位于 [forum.py](../image_service/forum.py)，表结构位于 [store.py](../image_service/store.py)，后台删除路径同步清理附件。

Markdown 只使用 Marked 的 lexer，然后以允许的 DOM 元素逐个创建内容。用户 HTML 作为文字显示；脚本、事件属性和危险 URL 不进入可执行 DOM。图片只读取论坛附件地址。

Marked 18.1.3 和 PDF.js 6.5.438 由 package-lock.json 固定。源码中保留本地生产资源和许可证；prepare-vendor 会从锁定依赖复制解析库、PDF worker、字符映射、字体和解码资源。PDF 使用 .js 扩展名以适配现有 Nginx JavaScript MIME 映射；使用现有 CSP，不增加 unsafe-eval。Node.js 构建环境需要 22.13+ 或 24。

~~~bash
npm ci
npm run build:production
node --test tests/forum.test.mjs tests/forum-editor-i18n.test.mjs
python3 -m unittest tests.test_forum_service tests.test_forum_discussion tests.test_forum_attachments -v
npm run test:forum:browser
~~~

Windows 按开发指南使用可用 Python 路径；浏览器回归可通过 STRGO_PYTHON 和 CHROME_PATH 指定程序。回归使用临时数据库和合成账号，仅监听本机，不调用模型或生产服务。8092 端口需空闲。

## 2026-11-04 验证记录

- 论坛前端及编辑器多语言测试 21 项通过，含 Markdown / HTML / URL 注入防护、导入失败保留草稿、上传重试幂等标识、上传期间禁止发帖和账号切换丢弃迟到响应。
- 原有论坛及讨论后端 27 项通过；附件测试覆盖权限、并发重复上传、文件校验、配额、过期、事务回滚、移除引用、删除和加密备份恢复。全站后台删除附件清理与后台回归另执行 17 项，通过。
- 真实 Chrome + HTTP + SQLite 验证了 UTF-8 导入、图片显示、未发布附件隔离、发布后会员访问、PDF 两页切换和原文件下载、Markdown 下载、图片说明编辑及退出后的清理。
- 浏览器覆盖五种语言、320 / 390 / 1440 像素宽度；通过生产 CSP 验证，无脚本错误或 CSP 违规。修正了窄屏顶栏和底部导航在长文案下的溢出。
- 主站完整验证通过：生产资源准备、生产构建、Node 185 项全部通过；Python 267 项中 257 项通过、10 项因 Windows 平台限制跳过。Linux CI 结果以本次提交实际运行记录为准；本机截图与日志在 artifacts/forum-editor/，不随源码提交。

本次交付范围为源码和 GitHub 提交。站点上线仍按 [DEPLOYMENT.md](../DEPLOYMENT.md) 备份数据库、更新账号服务和主站静态资源。
