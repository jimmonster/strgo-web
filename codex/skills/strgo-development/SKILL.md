---
name: strgo-development
description: 在 STRGO Web 仓库开发主站、独立应用或共享后端，定位构建、路由和集成问题，并选择对应验证；项目审查报告使用 strgo-review。
---

# STRGO Web 开发

路径均以 Git 仓库根目录为基准。先读 [开发指南](../../../doc/DEVELOPMENT.md)，需要确认模块归属时读 [架构](../../../doc/ARCHITECTURE.md)。

## 选择正确源码

- 主站、卧室、舞台、论坛、生图与管理员创作台在根 `src/`；共享账号及任务后端在 `image_service/`。
- AI 音乐、对话、助手和管理后台在 `src/ai-workspace/`、`image_service/ai_*.py`；先读 [AI 接入](../../../AI-WORKSPACE.md) 与 [接口契约](../../../doc/ai/implementation.md)，区分共享账号身份和单独的模块/模型授权。
- 独立应用在 `apps/<应用名>/`，各自保留锁文件和发布流程。根构建不会自动构建全部应用。
- DREAMS 修改后在 `apps/dreams/` 构建、测试并运行 `node scripts/sync-strgo.mjs`，再构建根主站。同步目标为根 `src/dreams/`，同步前检查集成副本有无未保存的手工修改。
- NEXUS 独立工程与 `src/nexus/` 副本同时存在；明确此次要影响的版本，核对主站实际读取的副本。
- 日常内容优先编辑 `content/site-content.json`、`site.json`。不要把 `dist/` 的手工改动当作源文件修复。

## 排错与验证

读取对应 `package.json` 和相关专题文档，按开发指南中的矩阵执行验证。根预览读取三条 `apps/<应用名>/dist`；独立空间 404 时先检查应用是否构建及部署 base，避免改动生产路由掩盖缺失产物。

Windows 路径从文件 URL 转换时使用 `fileURLToPath`，不要将 URL 的 `pathname` 直接交给本地文件系统。测试遇到 CRLF、UTF-8、缺少 Bash、目录 fsync 或符号链接问题时，分别记录平台原因和实际断言结果。

涉及共享账号时检查 Cookie、Origin、CSRF、成员/管理员边界与账号切换。涉及任务时保留请求幂等标识，区分上传重试和模型重生成，不能将中断后的自动重生成作为通用重试修复。修改 Workflow 恢复逻辑前读 [WORKFLOW.md](../../../WORKFLOW.md)。

AI本地模型与ComfyUI Workflow共用中央资源组锁；修改领取、超时和清理前读 [GPU调度](../../../doc/GPU-SCHEDULING.md)。Workflow成功/失败均需确认空闲卸载后释放，不能凭租期过期抢锁。涉及预算、额度、SSE或助手补丁时运行 `npm run test:ai`，验证重复提交、结算、权限变化及表单版本冲突。

完成后更新相关 `doc/` 文档；说明执行的验证和仍需 Linux、真实浏览器、Docker 或 GPU 的检查。用户要求上传 GitHub 时，只提交本次任务文件，保留其他未提交工作；网站发布按 [DEPLOYMENT.md](../../../DEPLOYMENT.md) 和本次授权范围执行。
