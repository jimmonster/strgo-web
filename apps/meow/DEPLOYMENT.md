# Meow · strgo.com/meow/ 发布

目标：`https://strgo.com/meow/`。`/meow` 会以 308 跳转至 `/meow/` 并保留查询参数。40 个页面与 26 个猫咪、画廊、商品详情均有静态目录文件，可以直接打开与刷新。

## 当前状态 · 2026-10-16

**Meow 应用已有成功发布记录。** `artifacts/deployment/receipt.json` 记录 2026-10-16 14:10（Asia/Shanghai）状态为 `deployed-local-verified`；当前链接为 `/var/www/meow/releases/20261016T060953Z-23858`。这表示发布脚本的本机 HTTPS 校验通过，独立公网与真实浏览器验收仍需另行确认。

- `artifacts/deployment-attempt.log`：早期受限会话尝试输出，该次在 socket 预检停止。
- `artifacts/deployment/receipt.json`：最新状态 `deployed-local-verified`，包含正式版本和回滚备份。
- `artifacts/deployment/manifest.json`：40 个地址、90 个文件及逐文件 SHA-256。
- `artifacts/deployment/meow.conf`：独立路由与内容安全策略。
- `artifacts/deployment/strgo.conf.candidate`：在现有 HTTPS 主机中新增一个 include，其余指令保持原样。

早期受限会话的独立 Nginx 测试输出保存在 `artifacts/deployment/nginx-syntax.log`；该历史记录不能替代最新发布回执。本次新增主站入口的发布仍在当前会话被 socket 权限阻断，未切换主站版本。

## 执行发布

在这台服务器的普通 root SSH / Workbench 终端执行，无需填写密钥或重新配置域名：

```bash
bash /root/meow/deploy.sh
```

脚本使用服务器现有 `strgo.com` HTTPS 配置与证书，不申请证书、不修改 DNS。无需重新安装依赖；构建依赖的 Three.js、字体、缩略图均已本地打包。

发布过程：

1. 按 `/meow/` 重新构建，生成文件指纹和候选配置。
2. 检查网络、systemd、Nginx、启用的虚拟主机和现有片段归属。
3. 锁定 Meow 发布，复制产物至 `/var/www/meow/releases/<版本>/meow/`，保存旧配置和版本位置。
4. 安装 `/etc/nginx/snippets/meow.conf`，为既有 HTTPS 主机添加 include，原子切换 `/var/www/meow/current`。
5. 运行 `nginx -t` 并重载，等待页面内容和 `X-Meow-Release` 指纹一致。
6. 逐文件核对 HTTP 200、SHA-256 和主要 MIME 类型，检查 `/meow?probe=1` 重定向以及未知地址的 HTTP 404。
7. 比较首页、NEXUS、DREAMS、POLYVERSE 发布前后的响应，成功后记录 `deployed-local-verified`。

校验请求使用 `--resolve strgo.com:443:127.0.0.1`，保持证书校验。完成后还应从其他设备打开 `https://strgo.com/meow/`，确认外部连通性。脚本的本机校验不等于独立公网验证。

`/root/strgo-homepage/deploy.sh` 已增加“片段存在时保留 Meow include 并校验首页”的逻辑。主站源码已加入顶部粉色 `MEOW`、手机菜单 `MEOW / 粉色猫咪天堂` 和第七张粉色空间卡片。要在线上显示这些入口，在普通终端执行 `bash /root/strgo-homepage/deploy.sh`；单独发布 Meow 应用不会更新主站首页。

## 只生成候选文件

```bash
cd /root/meow
npm run deploy:prepare
```

该命令只写项目内的 `dist/` 和 `artifacts/deployment/`，不会重载服务或修改系统配置。

## 回滚

安装配置或切换版本后任何一步失败，脚本会恢复原 `strgo.conf`、原 Meow 片段和旧 `current`，再尝试校验与重载。记录为 `rolled-back` 表示这些恢复步骤及重载完成；`rollback-attempted` 表示仍需人工检查。首次发布失败时移除新建的片段与 `current` 链接。发布文件和备份均保留，便于诊断。

成功后的手动回滚也应使用 `receipt.json` 中的 `rollbackBackup` 恢复旧配置，并将 `current` 指回 `previousTarget`（备份内也有 `previous-target` 文件），之后先 `nginx -t` 再 `systemctl reload nginx`。首次发布的 `previousTarget` 为空，恢复时应移除新建的 current 和片段，并恢复备份的主站配置。

## 验证范围

`npm run check` 验证数据、全部内部链接、模型与动作、DOM、本地状态和应用静态降级；部署测试另核对候选配置保留、策略范围以及旧版本响应不被当成就绪。主站构建回归另验证后续发布保留 Meow 路由。

当前环境无法执行真实 HTTP / Chromium 验收。普通终端发布后可执行：

```bash
cd /root/meow
MEOW_TEST_URL=https://strgo.com/meow/ npm run test:browser
```

该检查使用独立浏览器上下文，不会访问用户原有浏览器数据。视觉、手机操作、首屏猫体覆盖率和实际 GPU 性能的验收边界仍以 `ACCEPTANCE.md` 为准。
