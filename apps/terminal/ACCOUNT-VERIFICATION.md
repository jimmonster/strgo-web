# 账号终端验证记录

日期：2026-10-22。结论：源码、离线测试、release 构建与升级文件检查通过；未部署，真实浏览器与容器/网络端到端尚未验收。

## 已完成

| 检查 | 结果 |
| --- | --- |
| 需求先行、独立产品代理两轮核查 | 完成，记录于 `REQUIREMENTS.md`、`PRODUCT-REVIEW.md` |
| Rust 单元测试 | 19 项通过，包含账号边界、固定身份来源、私钥角色隔离、工作区卷与无网络参数 |
| 子会话 JavaScript/xterm 测试 | 27 项通过，包含真实 xterm 解析、中文/emoji/ANSI、密码分帧脱敏、复制粘贴和断开草稿保留 |
| 多窗口 DOM 交互测试 | 7 项通过，包含三窗口、来源验证、元数据恢复、账号切换、重命名、关闭、8 窗口限制与退出 |
| 主站 Python 回归 | 85 项通过，包含 7 项共享账号与旧 Cookie 迁移测试，以及原生图登录/CSRF/改密等回归 |
| 终端 Python 回归 | 29 项通过，包含重复 Set-Cookie 响应中保留共享 Cookie 的回归 |
| HTML 元素、子路径和 Rust 资源路由 | 通过，工作台与独立会话均检查 |
| JavaScript/Python/安装脚本语法 | 通过 |
| Cargo release，离线锁定依赖 | 通过，产物在 `.build/account-release/strgo-terminal` |
| 源码与编译件 SHA-256 清单 | `.build/account-release/SHA256SUMS`，用于升级前一致性检查 |
| `update-account.sh --check` | 通过，仅运行离线检查，未安装或重启服务 |

自动化用例合计 167 项通过；其中 DOM/xterm 用例不等同于真实浏览器渲染或 SSH 测试。

## 产品核查修复

- 服务器在提示文本之后拆包回显密码时，先前可能显示密码前缀。现在在每次渲染前隐藏任何位置的末尾密码前缀，后续命令中的迟到回显也脱敏；新增回归并由产品代理独立复测。
- 长单行输出仅按字符裁剪时补上「较早输出已省略」，避免未提示内容被省略。
- 身份 API 加入 8 秒超时，失败后可以重试；工作区退出与独立会话返回入口使用对应文案。
- 新增真实工作台的三窗口浏览器脚本，保留独立 SSH 会话浏览器回归；隐藏状态节点使用 attached 等待条件。

## 当前环境阻断

已实际尝试：

- Python 创建并绑定回环 socket，返回 `PermissionError: [Errno 1] Operation not permitted`。
- Playwright 启动本机 `/opt/google/chrome/chrome`，Chromium 因 `setsockopt: Operation not permitted (1)` 退出。

因此本次无法启动本地预览或服务、生成真实浏览器截图、执行 Docker/SSH/WS 端到端及更新系统服务。没有把这些检查标记为通过，也没有请求重复权限或修改生产环境。

## 用户授权后的部署尝试

用户随后明确要求部署，已实际执行 `bash update-account.sh`。构建文件 SHA-256、34 项 JavaScript 交互测试、7 项共享账号测试和资源路由检查通过；已部署生图服务的 `store.py`、`security.py`、`storage.py`、`cloud.py` 与仓库一致。

升级脚本在创建 socket 的安装前检查处返回 `PermissionError: [Errno 1] Operation not permitted` 并退出，未进入备份、安装或停止/启动服务阶段。另行执行 `systemctl is-active` 也返回 `Failed to connect to bus: Operation not permitted`，因此无法核实线上服务当前运行状态。日志保存在 `.build/account-release/deploy-attempt.log`（不包含密码或 Cookie）。

部署尚未完成，需要在具备系统权限和网络能力的普通服务器终端执行同一脚本。

## 部署环境仍需执行

- `npm run test:browser`：桌面/手机尺寸、软键盘视口、三窗口、恢复、共享退出；会生成截图。
- `bash tests/workspace-check.sh`：真实容器的无网络、UID、持久文件和隔离卷检查。
- `tests/smoke.py --account 测试账号`：真实共享登录、工作区命令、跨源拒绝与 30 秒内退出撤销。
- 真实手机系统剪贴板、SSH 登录、交互程序与断开清理。

使用和升级、回滚、容量治理见 [ACCOUNT-TERMINAL.md](ACCOUNT-TERMINAL.md)。
