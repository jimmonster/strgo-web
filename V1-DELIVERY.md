# STRGO V1.0 本地交付

需求日期：2026-10-17。实际源码为 `/root/strgo-homepage`，已检查 README、构建脚本、部署结构、现有页面与交互组件。项目不是 Git 仓库；改动前源码备份位于 `artifacts/requirements-v1/source-before.tar.gz`。本轮不发布线上，也未修改 Nginx、DNS 或独立终端服务。

## 四项完成状态

| 功能 | 实现状态 | 内容与验收状态 |
| --- | --- | --- |
| 探索导览 | 三条路线、逐站直达、五种主题筛选、原八个入口、标签与明确进入提示已实现，保留 `#spaces` | DOM 交互与本地资源处理检查通过；375/768/1440px 浏览器布局验收受阻 |
| 作品故事 | 三个独立目录页、原弹窗、首页故事入口、统一简介、体验入口、返回与下一件导航、独立元信息已实现，保留 `#projects` | 当前是简洁介绍；作者背景/职责/取舍尚未提供并隐藏。保留原站视觉预览，真实截图仍缺失，不宣称完整故事完成 |
| 最近更新 | 首页最多三条、独立完整列表、真实日期倒序、草稿过滤、无链接与空状态处理已实现 | 没有真实已发布记录，首页卡片区域隐藏；独立页为空状态。未发布示例单独保存，没有新增“已上线”公告 |
| 作者介绍 | 安全默认介绍、四个关注方向、三件代表作品、真实邮箱、复制失败提示已实现，保留 `#stack` 和原创作理念 | 职业/资历/合作类型未确认，未编造。空 GitHub 与坐标隐藏，活动矩阵继续标为示例，目标指标保留非实测标识 |

首页顺序保留首屏 → 空间导览 → 最近更新（有数据时）→ 作者介绍 → 精选作品 → 实验区 → 联系区。没有增加数据库、后台或新世界。现有图形、卡片、字体、按钮和动效组件继续复用。新增介绍页为静态内容；筛选无额外动画。较矮桌面窗口的作品区使用原生横向浏览，避免新增故事入口被固定高度裁切。

## 本地查看

```bash
cd /root/strgo-homepage
npm run build:production
npm run dev
```

在允许监听本机端口的终端中打开 `http://127.0.0.1:8080/`。

- `/projects/galactic-frontier/`
- `/projects/terminal-anywhere/`
- `/projects/digital-universe/`
- `/updates/`

已提供完整 `dist` 静态构建。目录路由继续兼容现有 Nginx `try_files` 和普通静态服务器。预览服务复用相邻 `/root/polyverse/dist`、`/root/meow/dist`、`/root/swarmera/dist`，本轮未修改这些应用。终端仍走原有入口与权限；未尝试连接服务器。

## 实际验证

| 检查 | 实际结果 |
| --- | --- |
| `npm run build:production` | 通过，本地依赖齐全，输出 production 构建 |
| `npm test` | 通过，五个 JavaScript 测试文件、16 个 Python 测试；包含原有场景、动画与生命周期回归 |
| 分类与还原 | 五种筛选、可见结果、单一选中状态、恢复八个入口通过 DOM 检查 |
| 首页、弹窗、独立页一致性 | 三个作品共用数据，名称/简介与体验入口检查通过 |
| 独立路由、重复请求和目录跳转 | 预览处理器直接测试通过；含真实页面、查询参数、静态资源与 404；尚不能替代浏览器刷新验收 |
| 更新数据 | 空数组、未发布示例、最多三条、倒序、无关联链接、撤回与错误日期检查通过；测试记录只存在于临时目录 |
| 内容真实性与隐藏 | 未确认章节/当前事项不输出，空社交与坐标不输出，目标与示例标签保留 |
| 联系复制 | 成功和失败提示、临时输入框清理通过现有 DOM 测试，真实 `mailto:` 入口保留 |
| CSS 解析与静态页面检查 | 新 CSS 解析通过；主要页面 ID 唯一，无空链接、模板残留或缺失本地资源 |
| `npm run dev` | 环境阻断：`listen EPERM: operation not permitted 127.0.0.1:8080` |
| `npm run test:content:browser` | `blocked`：当前环境禁止监听 socket，无可用浏览器截图 |
| `npm run test:browser` | 环境阻断：Chrome 在 socket / setsockopt 操作被禁止后退出 |
| 最新线上状态 | 当前环境域名解析失败，无法核对最新公开页面；核实依据为原项目代码、配置和已存在构建 |

日志位于 `artifacts/requirements-v1/build.log`、`tests.log`、`browser-check.log`、`original-browser.log`；浏览器结构化结果为 `artifacts/requirements-v1/browser/results.json`。

## 截图与剩余输入

本轮**没有获得实际浏览器截图，也没有完成手机、平板、桌面的视觉验收**。不将分享封面、原有插画或离屏诊断图当成截图交付。已提供 `npm run test:content:browser`，在正常终端执行后会生成 375、768、1440px 的导览、作者介绍、三个作品页与更新页共 18 张截图，并验证真实浏览流程。若发现布局问题，应继续修复后再验收。

真实作品截图尚缺，页面目前标明使用原有视觉插画或示意。每个作品还缺作者确认的创作起点、职责、过程取舍、完成限制与后续想法。真实更新记录、当前事项、职业经历、社交链接及具体合作意愿也尚未收到。缺少这些资料不阻塞已经实现的简洁介绍与内容机制。

维护说明：`CONTENT-MAINTENANCE.md`。内部字段/用途/状态清单：`CONTENT-MISSING.md`。未发布示例：`content/updates.example.json`。上述内部说明、示例和草稿均不复制到公开构建。

## 2026-10-18 部署尝试

已执行 `bash deploy.sh`。脚本在预检阶段因当前执行环境禁止 Python 网络 socket（`PermissionError: [Errno 1] Operation not permitted`）停止，尚未创建新 release，未切换 `/var/www/strgo/current`，未修改 Nginx 或线上版本。当前指向仍为 `/var/www/strgo/releases/20261016T105429Z-6059`。请在服务器普通 SSH/Workbench 终端以 root 执行同一命令。
