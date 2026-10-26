# 开发指南

## 环境与入口

在仓库根目录工作。生产部署文档使用 Node.js 22、Python 3、Ubuntu/Debian、Bash、Nginx 和 systemd；终端另需 Rust 1.88 与 Docker。开发时建议使用 Python 3.12，后端完整验证优先在 Linux 或 WSL 中执行。

Windows 可以运行静态构建和 Node 测试；部分部署测试、磁盘同步与权限操作依赖 Linux。请区分系统能力缺失与业务断言失败。

```bash
npm ci
python3 -m pip install -r image_service/requirements.txt
npm run build:production
npm run dev
```

访问 `http://127.0.0.1:8080/`。只预览静态页面时不需要启动账号后端；生图、论坛和 Workflow 的后端配置分别见相应专题文档。

若 Windows 上只有 `python` 命令，可直接运行 `python build.py --require-vendor`；先用 `node scripts/prepare-vendor.mjs` 准备正式依赖。Python 缺少时区数据时安装 `tzdata`，处理中文文件时启用 UTF-8。根 npm 脚本使用 `python3`，部分环境变量脚本使用 POSIX 语法。

PowerShell 开启本地 API 代理的写法为：

```powershell
$env:STRGO_IMAGE_API = '1'
node scripts/preview.mjs
```

这只开启预览代理；还需按 [生图说明](../IMAGE-PLAYGROUND.md) 启动回环地址的 API。更换预览端口可设置 `STRGO_PREVIEW_PORT`。

## 修改位置与集成

模块归属见 [架构](ARCHITECTURE.md)。主站内容优先修改 `content/site-content.json` 与 `site.json`；页面和交互修改 `src/`，避免直接编辑生成后的 `dist/`。

独立应用先进入 `apps/<应用名>/` 安装其锁定依赖，再运行构建与测试。根目录安装依赖不能替代所有独立应用的安装。

```bash
cd apps/dreams
npm ci
npm run build
npm test
node scripts/sync-strgo.mjs
cd ../..
npm run build:production
```

DREAMS 同步目标固定为当前仓库的 `src/dreams/`。同步会替换该集成副本，先提交或保存对它的手工修改。同步失败时保留原集成目录；异常中断若遗留 `src/.dreams-sync-*-previous`，先核对内容再清理。

NEXUS独立构建使用源码原样复制。修改后在根运行 `node apps/nexus/scripts/sync-strgo.mjs`，再运行 `node apps/nexus/scripts/sync-strgo.mjs --check` 和主站构建。同步先检查资源与相对依赖、暂存完整副本并校验，再替换 `src/nexus/`；失败保留旧副本。`--check` 只读比较独立应用源码与主站集成目录，发现缺失、多余或不同文件即失败。

POLYVERSE 生产构建使用 `BASE_PATH=/polyverse/`，MEOW 使用 `MEOW_BASE=/meow/`；Windows 请用 PowerShell 环境变量语法。独立应用构建完成后，根预览服务会从 `apps/polyverse/dist`、`apps/meow/dist`、`apps/swarmera/dist` 读取对应空间。

## 验证矩阵

| 改动范围 | 在对应目录执行 |
| --- | --- |
| 主站构建与公共交互 | 根目录 `npm run build:production`、`npm test` |
| 路由、作品内容 | 根目录 `npm run test:content:browser`；结合内容维护文档 |
| 生图 | 根目录 `npm run test:image`、`npm run test:image:browser` |
| 论坛与共享账号 | 根目录 `python3 -m unittest tests.test_forum_service tests.test_terminal_account -v` |
| 全站后台 | 根目录 `python3 -m unittest tests.test_admin -v`、`node --test tests/admin.test.mjs`；构建后 `node tests/admin-browser.mjs`；要求见 [后台说明](ADMIN-SYSTEM.md) |
| 本地工作流 | 根目录 `python3 -m unittest tests.test_local_studio tests.test_comfy_worker tests.test_workflow_http -v`、`npm run test:workflow:browser` |
| AI 音乐、对话和权限 | 根目录 `npm run test:ai`；接入、权限初始化与真实模型验收见 [AI-WORKSPACE.md](../AI-WORKSPACE.md) |
| DREAMS | 应用目录 `npm run build`、`npm test`；渲染变更再运行浏览器或 shader 检查 |
| POLYVERSE | 应用目录 `npm run build`、`npm test`；发布辅助变更运行 `npm run test:deployment` |
| MEOW | 应用目录 `npm run build`、`npm test`；部署测试需要 Bash 与符号链接能力 |
| SWARMERA | 先构建根主站和本应用，再在应用目录 `npm test`；部署测试使用临时 Nginx 配置样例 |
| NEXUS | 应用目录 `npm run build`、`npm test`；同时检查主站副本 |
| 终端 | 应用目录 `npm test`、`python3 -m unittest discover -s tests -p 'test_*.py'`、Linux 下 `cargo test`；真实容器另做验收 |

也可分开执行根测试，以免 Node 失败导致 Python 阶段没有运行：

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

主站 Node 测试中的页面检查需要先完成根构建。`artifacts/` 保存本地日志、截图和报告，属于生成内容；本轮 review 的可共享结论放在 [审查记录](PROJECT-REVIEW.md)。

## 发布与维护

发布步骤以 [DEPLOYMENT.md](../DEPLOYMENT.md) 为准。主站、独立应用和账号服务有各自的发布边界，修改根主站不会自动升级终端二进制或全部独立应用。

已有 ECS 可按部署文档安装 `strgo` 命令，以 `strgo deploy` 拉取 main 并依次更新各模块；`strgo check` 只读检查环境和任务。实现位于 `scripts/strgo`、`scripts/deploy_ecs.py`，离线回归为 `tests/test_ecs_command.py` 与 `tests/test_deploy_ecs.py`。真实发布仍在用户服务器执行，不能把离线检查记为生产验收。

修改会话、权限、用户数据、任务重试或工作流执行时，验证实际行为：普通成员不能越权、旧会话按预期失效、数据可恢复、同一任务不会重复生成。真实收费模型、GPU、Docker 或生产服务的验证结果必须与离线模拟测试分别记录。

新增开发说明放入 `doc/` 并更新索引；可重复使用的项目操作经验放入 `codex/skills/`。

## 统一验证和 CI

安装根及各应用的锁定依赖后运行 `npm run verify`，或使用 `node scripts/verify.mjs --root`、`--apps`、`--terminal` 选择范围。脚本先构建根主站，再按依赖关系构建和测试应用；不发布或调用真实模型。Python不在PATH时设置 `STRGO_PYTHON` 为可执行文件。`--browser` 额外执行需要Chrome及空闲回环8092端口的浏览器验收。

`.github/workflows/verify.yml` 在push、pull_request和手动触发时运行Linux检查：Node22、Python3.12、各应用构建/回归、Bash部署辅助回归，以及Rust1.88终端测试。Actions只读仓库权限，不部署生产。实际Linux结果以对应提交的CI运行记录为准。

Windows明确跳过Bash配置生成、创建符号链接与POSIX0600文件权限检查；这些在Linux CI执行。文件内容、持久化恢复、路径边界及业务断言仍在Windows运行。不能将跳过项记为通过。2026-10-23最终本机根Node91项通过，根Python204项中200项通过、4项平台跳过；终端Python31项中30项通过、1项平台跳过。Linux CI已实际跑通两个job，含终端Rust20项；提交与结果见 [审查记录](PROJECT-REVIEW.md)。


## 共享视觉与独立应用打包

现行规则见根 `DESIGN.md`。色彩、圆角和间距修改 `content/app-registry.json`；主构建生成 token。独立三维应用的构建通过 `scripts/integrate-strgo.mjs` 打包本地 `_strgo/`，不必改动其场景业务。不要手工修改生成目录。

终端的 token 由 `node scripts/sync-terminal-theme.mjs` 同步，`--check` 只读校验；`apps/terminal` 的资源准备也会执行同步。修改共享资源后按正常生产 base 重建对应应用。Workflow 的独立打包位于 `dist/local-studio/_strgo/`，导航使用 `data-session="none"`，不能把它的独立 Cookie 当作主站账号。
