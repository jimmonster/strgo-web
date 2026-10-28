# STRGO Web

该仓库包含 `https://strgo.com` 主站及其独立部署的站内应用。主站源码在仓库根目录；NEXUS 与 DREAMS 门户也集成在主站的 `src/` 下。

## 开发资料与 Codex

- [开发文档目录](doc/README.md)：架构、开发步骤、现有专题文档和整仓审查记录。
- [功能清单](doc/FEATURE-BACKLOG.md)：优先级、完成记录与需要外部处理的事项。
- [Codex 技能目录](codex/README.md)：项目开发和 review 技能，以及下次会话的调用示例。
- [项目指令入口](AGENTS.md)：让后续 Codex 会话找到上述文档和技能。

## 项目

- 主站、AI 图片工作台、集成的 NEXUS 与 DREAMS 门户：仓库根目录
- 全站管理后台：`src/admin/`，构建入口 `/admin/`，账号、邀请码、社区、额度、任务和审计见 [后台说明](doc/ADMIN-SYSTEM.md)。
- 独立管理员本地创作台（H3 / Qwen-Image-2.1）：`src/local-studio/`，配置与部署见 [WORKFLOW.md](WORKFLOW.md)

- AI 音乐、可复用创作助手、独立对话与模型权限后台：`src/ai-workspace/`，部署与接入见 [AI-WORKSPACE.md](AI-WORKSPACE.md)
- 终端：`apps/terminal/`
- 会员交流社区：`src/forum/`，复用 AI 生图与终端账号，说明见 [FORUM.md](FORUM.md)
- DREAMS 独立应用：`apps/dreams/`
- POLYVERSE：`apps/polyverse/`
- MEOW：`apps/meow/`
- SWARMERA：`apps/swarmera/`
- 360° 全景：`src/panorama/`，构建入口 `/360/`，支持校园、本地图片和 AI 生图作品；见 [全景模块](doc/PANORAMA-360.md)。
- NEXUS 独立项目与测试：`apps/nexus/`（网站集成版本位于 `src/nexus/`）

各应用保留自己的依赖锁文件、测试、部署脚本和项目说明。统一仓库的安装、升级与验收见 [部署说明](DEPLOYMENT.md)；主站的详细说明见 [HOMEPAGE-README.md](HOMEPAGE-README.md)。

## 本地构建和测试

主站需要 Node.js 与 Python 3：

```bash
npm ci
npm run build
npm test
```

独立静态应用可分别在对应的 `apps/<name>/` 目录安装依赖，再运行 `npm run build` 与 `npm test`。终端服务使用 Rust/Cargo，具体步骤见 `apps/terminal/README.md`。生产发布仍按各应用的部署说明执行。

安装各模块依赖后用 `npm run verify` 执行统一构建与回归；Linux CI还运行部署辅助和终端Rust检查，范围与跨平台说明见 [开发指南](doc/DEVELOPMENT.md)。

生成目录、依赖安装、运行数据与本地环境文件不纳入版本控制；`.env.example` 示例配置可以提交。
