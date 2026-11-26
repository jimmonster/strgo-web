# AI 视频

/video/ 提供手机适配的文生视频、任务记录、硬盘归档、在线播放和下载。主页与功能切换器使用 C07。生成权限独立于对话、音乐和生图，管理员默认可生成，普通成员需要管理员在视频页明确授权。

## AutoDL 工作流

管理员在 /video/#admin 加载完整官方目录，或粘贴工作流详情 URL / ID。每项显示官方标题、详情 URL、工作流 ID 和实际提交 URL。标题及输入字段由服务器核对 AutoDL 工作流详情。替换操作在同一事务中停用旧工作流、启用新工作流。新任务使用新参数，历史任务保存原工作流 ID、标题和已验证的生成参数。旧工作流尚未提交的排队任务会停止。

目录包含全部类型的工作流。本页仅启用具有 prompt 输入和 MP4 输出的文生视频工作流，必填图片、音频或其他不支持的参数会阻止启用。时长、分辨率、种子等表单字段来自所选工作流的输入规则。费用以对应官方页面为准，提交前显示参数并要求确认付费。

官方入口与接口说明

- https://www.autodl.art/large-model/comfyui
- https://autodl.art/docs/comfyui_api/

目录元数据使用 POST /api/v1/comfyui/workflows 与 GET /api/v1/comfyui/workflows/{id}。提交使用 POST /api/v1/comfyui/comfyui_workflow/{id}，查询使用 GET /api/v1/comfyui/comfyui_workflow/result/{task_id}。目录字段契约来自 AutoDL ComfyUI 集成的公开实现，实际可用性需由生产环境连接 AutoDL 核实。目录失败时仍可尝试按 URL 核对详情，核对失败不启用该接口。

## 部署配置

在 ECS 的 /etc/strgo-image.env 配置 AUTODL_COMFYUI_TOKEN，使用分组为 ComfyUI 的令牌，文件权限保持 0600。令牌仅由服务器使用。部署根主站与账号 API 后重启 strgo-image 服务。现有 strgo deploy --skip-terminal 可完成常规更新。使用页面启用工作流和授权成员。

视频保存在 IMAGE_DATA_DIR/videos/<job-id>/<index>.mp4，默认 /var/lib/strgo-image/videos/。文件通过当前账号校验后分块输出，支持 Range 拖动与下载。目录独立于静态产物，文件无自动到期清理。备份时同时备份 playground.sqlite3 和 videos/，已有账号配置备份不替代视频文件备份。

每位用户同时最多一个活动任务。提交请求有持久化幂等编号。AutoDL 提交超时或进程在提交中退出会标为待核实，需管理员到 AutoDL 核对账单与任务。持有远端任务编号的任务恢复查询，保存失败只重试下载。单文件最多 128 MiB，单任务最多 8 个视频，开始提交及保存前保留至少 512 MiB 空间。自动查询和保存窗口为提交后 23 小时。

## 验证

- python3 -m unittest tests.test_video -v 验证权限、Origin / CSRF、并发幂等、工作流替换、重启恢复、保存重试、文件归属与 Range。
- 根构建后执行 node tests/video-browser.mjs，使用临时账号和假上游，检查手机布局、标题与 URL 对应、替换、授权、提交确认与私有文件。
- node scripts/verify.mjs --root 和 GitHub Actions 检查主站构建及相关回归。

自动化验证使用模拟上游，不产生真实生成费用。生产令牌、目录元数据与真实 MP4 生成需部署后实测。
