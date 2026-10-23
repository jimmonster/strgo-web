# 门户功能与视觉清单

由 `content/app-registry.json` 生成；请修改源清单后执行 `python3 scripts/sync-hub-docs.py`。

共 26 个主入口、8 个沉浸空间。访客和成员可见 24 个入口；管理员额外可见 Workflow 与管理控制台。可见入口不表示已取得模块或模型授权。

| 编号 | 功能 | 路径基准 | 分类 | 访问条件 |
| --- | --- | --- | --- | --- |
| C01 | AI 生图 | `/image-playground/` | 创作工具 | 需登录 |
| C02 | AI 对话 | `/ai/chat/` | 创作工具 | 按授权使用 |
| C03 | AI 音乐 | `/ai/music/` | 创作工具 | 按授权使用 |
| C04 | 终端 | `/terminal/` | 创作工具 | 需登录 |
| C05 | Workflow | `https://workflow.strgo.com/` | 管理 | 管理员 · 独立登录 |
| C06 | 创作概览 | `/ai/` | 创作工具 | 已有页面 |
| S01 | 阳光卧室 | `/home` | 沉浸空间 | 公开体验 |
| S02 | 舞蹈舞台 | `/dance` | 沉浸空间 | 公开体验 |
| S03 | 星际穿越 | `/nexus/` | 沉浸空间 | 公开体验 |
| S04 | 梦境花园 | `/dreams/` | 沉浸空间 | 公开体验 |
| S05 | 多维几何宇宙 | `/polyverse/` | 沉浸空间 | 公开体验 |
| S06 | 粉色猫咪天堂 | `/meow/` | 沉浸空间 | 本地体验 |
| S07 | 虫族狂潮 | `/swarmera/` | 沉浸空间 | 本地体验 |
| S08 | 银河归档 | `/archive/` | 沉浸空间 | 公开体验 |
| N01 | 交流社区 | `/forum/` | 社区内容 | 需登录 |
| N02 | 精选作品 | `/classic/#projects` | 社区内容 | 公开浏览 |
| N03 | 创作记录 | `/updates/` | 社区内容 | 内容待补 |
| N04 | 关于 STRGO | `/classic/#stack` | 社区内容 | 公开浏览 |
| N05 | 交互实验 | `/classic/#lab` | 社区内容 | 公开体验 |
| N06 | 联系作者 | `/classic/#contact` | 社区内容 | 公开浏览 |
| U01 | 我的作品 | `/ai/assets/` | 我的工作区 | 需登录 |
| U02 | 任务中心 | `/ai/tasks/` | 我的工作区 | 需登录 |
| U03 | 账号与权限 | `/ai/settings/` | 我的工作区 | 需登录 |
| U04 | 账号登录 | `/ai/login/` | 我的工作区 | 已有入口 |
| A01 | 管理控制台 | `/admin/ai/` | 管理 | 管理员 |
| N07 | 经典主页 | `/classic/` | 社区内容 | 保留原入口 |

终端地址和 Workflow 域名由 `site.json` 的 `TERMINAL_TARGET_URL`、`WORKFLOW_ORIGIN` 覆盖；构建产物中的注册表保存实际地址。

## 视觉变量

| 变量 | 值 |
| --- | --- |
| `bg` | `#070b10` |
| `surface` | `#0e151c` |
| `border` | `#27333b` |
| `text` | `#f1f7f7` |
| `muted` | `#9aaab4` |
| `accent` | `#79f8cb` |
| `violet` | `#a59bff` |
| `warning` | `#f4c576` |
| `radius` | `18` |
| `spacing` | `8` |

颜色使用十六进制；radius 和 spacing 的单位为 px。构建输出 `/hub/tokens.css`，供门户、生图和 AI 工作区共用。
