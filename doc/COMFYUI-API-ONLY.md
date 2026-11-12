# 独立 ComfyUI API 工作台已撤下

2026-11-12：因当前 ECS 内存不足，停止部署 `comfyui.strgo.com` 独立 ComfyUI API 工作台，并移除其后台入口、SSO 接口、网关、节点和部署脚本。仓库与 CI 不再安装此功能专用依赖。

撤下时确认 `strgo-comfyui.service` 和 `strgo-comfyui-ws.service` 均未运行，专用安装目录、systemd 单元和 Nginx 站点配置不存在。因此本次没有停止正在运行的 ComfyUI 进程，也不计入已释放的内存。

已有 [Workflow 本机工作流](../WORKFLOW.md)、AI 工作区和生图功能继续保留。已有账号数据库中的历史 ComfyUI SSO 表保留原数据，不执行删表或账号数据迁移；移除接口后这些授权不再可用。

本记录保留供历史链接查阅，不再作为部署入口。

本次验证：生产构建通过；`tests.test_admin`、`tests.test_terminal_account`、`tests.test_local_studio`、`tests.test_comfy_worker` 共 42 项 Python 回归通过。根 Node 回归中 29 个测试文件通过；`app-previews.test.mjs` 和 `preview-api.test.mjs` 因沙箱禁止监听回环端口（`listen EPERM`）失败，未记为通过。

此次完成仓库代码撤下与本地构建，未重新发布生产主站和账号服务。后续正常发布会同步移除其代码入口。
