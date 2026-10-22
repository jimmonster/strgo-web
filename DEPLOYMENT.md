# STRGO Web 统一仓库部署

更新日期：2026-10-22。以下操作在 Ubuntu / Debian 服务器的普通 SSH 或阿里云 Workbench 终端中以 root 执行。需要可用的网络、systemd、Nginx、Node.js 22、npm、Python 3、`python3-venv` 和 `python3-pip`；终端另需 Docker。受限开发会话无法创建 socket 时，应在普通服务器终端运行。

## 1. 获取代码

统一仓库为 `git@github.com:jimmonster/strgo-web.git`，主分支为 `main`。首次拉取前，在服务器配置能够访问该 GitHub 仓库的 SSH 密钥：

```bash
git clone git@github.com:jimmonster/strgo-web.git /root/strgo-web
cd /root/strgo-web
```

已有该仓库时，先确认工作区干净，再更新：

```bash
cd /root/strgo-web
git status --short --branch
git pull --ff-only origin main
git log -1 --oneline
```

若服务器上存在尚未提交的配置或本地提交，先保存并合并；`--ff-only` 遇到分叉会停止。后续主站操作均从 `/root/strgo-web` 执行，独立应用从 `apps/<应用名>/` 执行。

## 2. 准备主站并验证

核对 `site.json` 的 `BASE_ORIGIN`、`scheme` 和 `TERMINAL_TARGET_URL`，以及账号服务 `/etc/strgo-image.env` 的 `IMAGE_PUBLIC_ORIGIN` 是否使用同一 HTTPS 域名。当前项目使用 `https://strgo.com` 与 `https://strgo.com/terminal/`。首次部署需确保域名解析正确，并开放入站 TCP 80 / 443。

```bash
cd /root/strgo-web
npm ci
npm run build:production
npm test
```

生产构建会准备主站的本地 vendor 资源。只运行 `git pull` 或 `npm run build` 不能代替完整发布。

## 3. 升级账号、生图与论坛

适用于当前 ECS 本地硬盘存储部署。论坛复用账号服务和原数据库，需要一起更新 `image_service/app.py`、`store.py`、`forum.py` 等模块。终端账号升级脚本只替换账号服务的 `app.py`，因此应先通过下述安装脚本对齐整个账号服务。

先暂停新生图请求，等待现有任务完成，在维护窗口执行。已有服务时先运行加密数据库备份，并保留 `/etc/strgo-image.env` 的加密密钥：

```bash
(
  set -e
  cd /opt/strgo-image
  .venv/bin/python -m image_service.cli --env /etc/strgo-image.env backup
)
```

备份输出的对象键对应 `/var/lib/strgo-image/files/image-playground/system/backups/` 下的加密文件。数据库备份不包含图片原文件；完整恢复还需要另行保存持久化数据目录与原加密密钥。首次安装没有旧服务时跳过备份。

在已安装 Nginx 和 Python 虚拟环境工具的服务器中，更新服务并发布主站：

```bash
(
  set -e
  cd /root/strgo-web
  bash image_service/deploy/install.sh
  bash deploy.sh
)
```

安装脚本保留既有账号、图片、数据库与加密密钥，将图片存储设为本地硬盘。若现有服务使用 OSS，应先按 [生图说明](IMAGE-PLAYGROUND.md) 完成数据迁移。服务启动时自动建立论坛表；论坛入口为 `/forum/`，接口沿用 `/api/image/`，不增加公开端口。

首次申请主站 HTTPS 时，将上述 `bash deploy.sh` 改为 `bash deploy.sh --email 你的真实邮箱`；提供邮箱表示同意 Let's Encrypt 服务条款。已有证书时直接运行 `bash deploy.sh` 即可。

首次部署且没有管理员时，在账号服务安装完成后生成首个管理员邀请码：

```bash
(
  set -e
  cd /opt/strgo-image
  .venv/bin/python -m image_service.cli --env /etc/strgo-image.env invite --admin
)
```

## 4. 更新已有账号终端

需要已有 `strgo-image`、`strgo-terminal` 与 `strgo-terminal-broker` 服务。终端页面嵌入 Rust 程序，新的社区入口、iPhone 布局和沙箱启动修复必须重新构建并安装二进制才会生效。

以下使用仓库自带的 native 构建脚本准备项目内 Rust 1.88.0 工具链、前端资源及沙箱镜像；无需依赖其他旧源码目录，也不从 Docker Hub 拉取基础镜像。首次构建需要下载依赖，耗时取决于网络。

```bash
(
  set -e
  cd /root/strgo-web/apps/terminal
  npm ci --ignore-scripts --no-audit --no-fund
  bash scripts/build-native.sh
  mkdir -p .build/account-release
  install -m 0755 .build/strgo-terminal .build/account-release/strgo-terminal
  sha256sum .build/account-release/strgo-terminal Cargo.toml Cargo.lock build.rs \
    src/*.rs web/*.html web/*.js web/*.css web/vendor/*.js web/vendor/*.css \
    ../../image_service/app.py tests/*.mjs tests/*.py deploy/*.service deploy/*.conf \
    update-account.sh update-mobile.sh repair-sandbox.sh \
    > .build/account-release/SHA256SUMS
  bash update-account.sh --check
  bash update-account.sh
)
```

更新会结束已有终端连接并重启账号 API；保留工作区卷、账号数据及服务配置。升级脚本检查当前生图任务、模块版本和沙箱，在失败时尝试恢复旧程序，并输出备份路径。账号服务与主站的前述更新不是同一个事务，应保留各自备份。`--check` 仅执行离线检查，不能替代真实服务验收。

首次安装终端时，在主站 HTTPS、账号服务及 Docker 已就绪后执行：

```bash
bash /root/strgo-web/apps/terminal/publish.sh --build-mode native
```

若只需临时修复旧服务的沙箱启动目录问题，可执行 `bash /root/strgo-web/apps/terminal/repair-sandbox.sh`；它不会安装新界面。使用与回滚细节见 [账号终端说明](apps/terminal/ACCOUNT-TERMINAL.md)。

## 5. 独立空间

主站已经集成 NEXUS 与 DREAMS 门户。POLYVERSE、MEOW 与 SWARMERA 仍使用各自发布目录；按需更新，不能只发布主站来更新独立应用。

```bash
(set -e; cd /root/strgo-web/apps/polyverse; npm ci; BASE_PATH=/polyverse/ npm run build; bash deploy.sh)
(set -e; cd /root/strgo-web/apps/meow; npm ci; bash deploy.sh)
(set -e; cd /root/strgo-web/apps/swarmera; npm ci; bash deploy.sh)
```

SWARMERA 发布末尾会从当前统一仓库再次发布主站入口；如需指定其他主站源码，可设置 `STRGO_HOMEPAGE_DIR=/实际主站路径`。旧独立项目布局仍兼容 `/root/strgo-homepage`。

## 6. 发布后验收

```bash
nginx -t
systemctl is-active nginx strgo-image strgo-terminal strgo-terminal-broker
curl --fail --show-error https://strgo.com/forum/ -o /dev/null
curl --fail --show-error https://strgo.com/image-playground/ -o /dev/null
curl --fail --show-error https://strgo.com/terminal/ -o /dev/null
python3 /root/strgo-web/apps/terminal/tests/broker-smoke.py
python3 /root/strgo-web/apps/terminal/tests/smoke.py --env /etc/strgo-terminal/web.env
python3 /root/strgo-web/apps/terminal/tests/smoke.py --env /etc/strgo-terminal/web.env --account 测试账号
```

没有安装终端时跳过对应服务与探针。使用测试账号确认三处共享登录、论坛发帖与管理员置顶、终端真实命令执行，以及 iPhone 弹出键盘后的布局。仅服务 active 或页面 HTTP 200 不能证明这些功能可用。

主站部署失败会尝试回滚当前链接及 Nginx 配置；其他服务的恢复按其备份与说明分别处理。账号数据库恢复见 [生图备份恢复](IMAGE-PLAYGROUND.md)。这份文档提供部署步骤，不表示已经完成生产发布。
