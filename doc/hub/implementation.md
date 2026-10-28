# 门户实现与维护

## 文件映射

| 文件 | 职责 |
| --- | --- |
| `content/app-registry.json` | 功能名称、ID、路径、分组、访问说明、画面编号、视觉变量 |
| `src/hub/` | 门户、目录、空间详情、账号偏好、任务和作品页面 |
| `src/panorama/` | `/360/` 全景浏览、本地/AI 作品导入，目录使用 S09 |
| `src/shared/site-navigation.js` / `.css` | 使用相同清单的内嵌应用切换器；独立 Shadow DOM、外部样式 |
| `src/image-playground/hub-theme.css`、`hub-links.js` | 生图主题和安全的原任务深链 |
| `image_service/hub.py` | 当前用户的只读聚合索引，无新的业务数据库 |
| `hub_build.py`、`build.py` | registry/tokens 生成、路由输出、版本摘要、经典版保留 |
| `scripts/sync-hub-docs.py` | 从注册表生成可审阅的功能表和视觉变量表 |

根构建仍不替代 `apps/*` 的独立构建。NEXUS 切换器放在根站实际使用的 `src/nexus/`；`apps/nexus/` 独立工程保持原状，未来同步覆盖时应保留这项集成。DREAMS 不直接修改同步副本。

## HTTP 契约

`GET /api/image/hub/tasks` 与 `GET /api/image/hub/assets` 使用已有共享 Cookie。新接口没有写入方法；新增服务代码通过现有 `/api/image/` 代理到 8092，无须扩展跨域权限。

| 参数 | 规则 |
| --- | --- |
| `source` | `all`、`image`、`music`、`chat`；作品不接受 chat |
| `status` | `all` 或设计文档中列出的统一状态 |
| `limit` | 整数 1–50，默认 24 |
| `cursor` | 不透明 base64url；绑定列表类型、来源和状态，错误上下文返回 400 |

响应为 `{user_id, items, sources, next_cursor, partial}`。item 含 `key/source/id/title/created/updated/raw_status/status/status_label/error/actions`；作品另有鉴权预览、下载、期限信息。图像 updated 为 null。sources 状态为 `ok`、`permission_required` 或 `unavailable`；失败来源不会伪装成成功空列表。每个来源在 SQL 层筛选并最多读取 `limit+1` 条，再合并分页。同一秒内按来源+ID稳定排序。

所有查询在服务端约束 owner，管理员也不例外。AI 额外检查有效成员、模块开关、授权期限和当前模型授权；撤销模型授权后不再聚合其旧记录。删除的对话任务不暴露正文线索，音乐过期/删除/待删除作品不返回。只投影所需字段，聚合不查询 Provider 网络。120 次/分钟/账号限流。

新接口仅读取已有业务表，限流仍使用既有 limits 表。各来源的 SQLite 查询错误被标记为部分失败，不将数据库路径或异常文本返回前端。游标不能代替授权，每页仍重新检查当前账号。源服务恢复后可“返回最新”重新获取完整列表。

取消、保存重试和删除继续调用原 API，前端白名单校验操作类型与精确资源 ID；提交前重新验证身份，使用新的 CSRF，原服务仍校验 Origin/CSRF/权限。超时不自动重复生成。图像保存重试仅同步已有文件；音乐复用创建草稿而不生成。

## 构建、发布和回滚

```bash
npm ci
python3 scripts/sync-hub-docs.py --check
npm run build:production
npm test
npm run test:ai
```

默认配置以 `HOME_VARIANT=hub` 将统一门户生成在根首页，`/hub/` 和 `/classic/` 继续保留。与部署既有功能一样，需同时更新共享 Python 服务和静态页面，按 [统一部署说明](../../DEPLOYMENT.md) 进行备份、维护窗口和服务重启；仅发布静态页面会使新聚合接口不可用，界面将显示错误而不是假作品。不存在新的数据迁移或数据库清空步骤。

`HOME_VARIANT` 是 `site.json` 字段或 `build.py --home-variant` 参数，不是浏览器设置，也不隐式读取同名环境变量。建议持久修改 `site.json` 后走常规构建；一次性的命令行覆盖仅影响该次产物。保留 `/classic/` 的绝对资源路径，避免从子目录读取错误资源。

要回滚根首页，恢复 `classic` 配置并构建/发布。要回滚整版，恢复之前的静态产物及服务代码；聚合模块没有修改任务、作品或额度数据。用户后续执行的删除等操作仍受原模块生命周期约束，不能通过代码回滚恢复已删除作品。

## 文档一致性

新增入口先编辑注册表，再运行 `python3 scripts/sync-hub-docs.py`，同步更新画面/行为规格和验收记录。`python3 scripts/sync-hub-docs.py --check` 与根测试会阻止功能表或视觉变量文档漂移。视觉截图属于对应版本的验收证据；不得用原型的演示任务截图宣称生产记录已生成。

## 2026-10-29 根首页切换验证

生产构建通过；根 Node 152 项、Python 238 项通过。HTTP 本地预览检查了 `/`、`/hub/`、`/classic/` 和门户资源；DOM 回归检查了空间入口及经典锚点跳转。当前环境没有 Chromium，真实浏览器回归尚未执行；以上验证也不代表已部署生产站点。
