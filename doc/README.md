# 开发文档

开发资料统一从此处查阅，新增开发文档存放在 `doc/`。

## 从这里开始

| 文档 | 内容 |
| --- | --- |
| [多语言适配](MULTILINGUAL.md) | 语言切换、翻译范围和已知缺口 |
| [统一体验与社区功能](IMPECCABLE-UPGRADE.md) | Impeccable 视觉系统、跨应用导航、编辑/评论/通知与本轮验收 |
| [架构与模块](ARCHITECTURE.md) | 主站、六个应用、共享后端、数据与发布边界 |
| [开发指南](DEVELOPMENT.md) | 环境、构建、集成、测试与跨平台注意事项 |
| [功能缺口与执行清单](FEATURE-BACKLOG.md) | 优先级、外部依赖、实施顺序及完成证据 |
| [全站后台需求](ADMIN-SYSTEM.md) | 统一管理入口、账号治理、审计与验收 |
| [GPU调度与恢复](GPU-SCHEDULING.md) | AI / Workflow中央互斥、卸载确认与人工恢复 |
| [整仓 review：2026-10-23](PROJECT-REVIEW.md) | 已修复问题、验证结果与待完成项目 |
| [Codex 技能](../codex/README.md) | 后续开发和 review 的可复用流程 |

## 现有专题文档

现有文档保留原路径，通过索引集中查阅。历史文档中的旧目录、日期和上线状态应结合当前源码核实；当前统一部署以 [DEPLOYMENT.md](../DEPLOYMENT.md) 为准。

| 主题 | 文档 |
| --- | --- |
| 仓库和主站 | [README](../README.md)、[主站历史说明](../HOMEPAGE-README.md) |
| 统一门户与主页切换 | [设计规格 v3.1](hub/design-v3.1.md)、[功能与视觉清单](hub/registry.md)、[实现与接口](hub/implementation.md)、[验收](hub/acceptance.md) |
| 部署和运维 | [统一部署](../DEPLOYMENT.md)、[NEXUS 集成部署](../NEXUS-DEPLOYMENT.md) |
| 生图与共享账号 | [生图工作台](../IMAGE-PLAYGROUND.md) |
| 管理员本地工作流 | [Workflow / ComfyUI](../WORKFLOW.md) |
| AI 音乐、对话与权限 | [功能与接入](../AI-WORKSPACE.md)、[设计](ai/design-v1.0.md)、[实现与接口](ai/implementation.md)、[验收](ai/acceptance.md) |
| 社区 | [论坛说明](../FORUM.md) |
| 内容与作品 | [内容维护](../CONTENT-MAINTENANCE.md)、[待补内容](../CONTENT-MISSING.md) |
| DREAMS | [应用说明](../apps/dreams/README.md)、[部署](../apps/dreams/DEPLOYMENT.md)、[资源](../apps/dreams/ASSETS.md) |
| POLYVERSE | [应用说明](../apps/polyverse/README.md)、[部署](../apps/polyverse/DEPLOYMENT.md)、[测试记录](../apps/polyverse/TEST-REPORT.md) |
| MEOW | [应用说明](../apps/meow/README.md)、[部署](../apps/meow/DEPLOYMENT.md)、[验收](../apps/meow/ACCEPTANCE.md) |
| SWARMERA | [应用说明](../apps/swarmera/README.md)、[路由](../apps/swarmera/ROUTES.md)、[测试记录](../apps/swarmera/TEST-REPORT.md) |
| NEXUS | [应用说明](../apps/nexus/README.md)、[资源](../apps/nexus/ASSETS.md) |
| 终端 | [应用说明](../apps/terminal/README.md)、[当前账号版](../apps/terminal/ACCOUNT-TERMINAL.md)、[当前验证](../apps/terminal/ACCOUNT-VERIFICATION.md)、[iPhone](../apps/terminal/IPHONE-FULLSCREEN.md) |
| 历史交付 | [验收记录](../ACCEPTANCE.md)、[场景交付](../SCENES-DELIVERY.md)、[V1 交付](../V1-DELIVERY.md) |

文档应说明适用模块、操作目录、验证方式和未完成项。审查记录按当时实际结果书写；后续修复时更新状态和验证日期。
