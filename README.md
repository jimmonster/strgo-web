# STRGO Web

该仓库包含 `https://strgo.com` 主站及其独立部署的站内应用。主站源码在仓库根目录；NEXUS 与 DREAMS 门户也集成在主站的 `src/` 下。

## 项目

- 主站、AI 图片工作台、集成的 NEXUS 与 DREAMS 门户：仓库根目录
- 终端：`apps/terminal/`
- 会员交流社区：`src/forum/`，复用 AI 生图与终端账号，说明见 [FORUM.md](FORUM.md)
- DREAMS 独立应用：`apps/dreams/`
- POLYVERSE：`apps/polyverse/`
- MEOW：`apps/meow/`
- SWARMERA：`apps/swarmera/`
- NEXUS 独立项目与测试：`apps/nexus/`（网站集成版本位于 `src/nexus/`）

各应用保留自己的依赖锁文件、测试、部署脚本和项目说明。主站的详细说明见 [HOMEPAGE-README.md](HOMEPAGE-README.md)。

## 本地构建和测试

主站需要 Node.js 与 Python 3：

```bash
npm ci
npm run build
npm test
```

独立静态应用可分别在对应的 `apps/<name>/` 目录安装依赖，再运行 `npm run build` 与 `npm test`。终端服务使用 Rust/Cargo，具体步骤见 `apps/terminal/README.md`。生产发布仍按各应用的部署说明执行。

生成目录、依赖安装、运行数据与本地环境文件不纳入版本控制；`.env.example` 示例配置可以提交。
