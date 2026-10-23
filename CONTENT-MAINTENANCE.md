# STRGO 内容维护

作者、作品与更新内容沿用 HTML / CSS / JavaScript 和 Python 静态构建，编辑 `content/site-content.json` 和 `site.json` 后运行 `npm run build:production`。账号、邀请码、社区与额度另由 [统一后台](doc/ADMIN-SYSTEM.md) 管理，后台不编辑本文的作者作品资料。

## 预览与验证

```bash
# 在当前仓库根目录执行
npm run build:production
npm run dev
```

浏览器访问 `http://127.0.0.1:8080/`。本地服务将 `/polyverse/`、`/meow/`、`/swarmera/` 映射到当前仓库的 `apps/<应用名>/dist`。缺少对应构建时返回404；这不会影响主站作品介绍页。终端保留原有访问条件，本地入口只引导至 `site.json` 中已存在的服务地址。

通过 `node scripts/preview.mjs --port 8081` 更换端口。浏览器检查需要允许回环端口监听及可启动的Chrome，可通过 `STRGO_CHROME` 指定可执行文件。2026-10-23的Windows环境已实际运行通过，历史容器的socket阻断不适用于当前环境。

```bash
npm test                       # 现有回归 + 内容、路由与交互检查
npm run test:content:browser    # 375 / 768 / 1440px 流程与截图
npm run test:browser            # 原有主页浏览器回归
```

新增浏览器检查自动启动预览服务，截图写入 `artifacts/requirements-v1/browser/`，每种宽度包含 `guide`、`author`、三个作品以及 `updates` 共六张。`results.json` 区分 `passed`、`failed` 与环境阻断 `blocked`。检查受阻时不生成或假装生成截图。

`dist/projects/作品标识/index.html` 和 `dist/updates/index.html` 是真实目录文件。静态服务直接打开、刷新均使用对应页面，继续兼容原来的 Nginx `try_files $uri $uri/ =404`。本轮没有执行部署脚本。

## 空间与路线

编辑 `content/site-content.json`：

- `spaces`：`id` 是稳定标识；`name`、`description`、`path` 是公开名称、简介和现有入口；`tags` 为一至两个可见标签；`categories` 可包含多个分类标识。
- `filters`：筛选项名称与标识。保留 `all`；其他标识与 `categories` 对应。
- `routes`：按 `stops` 数组顺序展示站点，每个站点独立可点击，主按钮始终进入第一站。引用空间 `id`；作者路线可引用 `about`、`projects`、`contact`，分别指向 `#stack`、`#projects`、`#contact`。
- `style` 对应原有卡片样式，原 SVG 图形保存在 `src/partials/portal-*.html`。无需编辑页面中的重复卡片。

无 JavaScript 时会展示全部空间和原生路线链接，并隐藏不可用的筛选按钮。筛选没有额外动画，保留原有动态效果开关与系统偏好。

## 作品介绍与完整故事

编辑同一文件的 `projects`。首页卡片、原弹窗、独立页共用名称、简介和链接。

- `id`：原弹窗使用的标识；`slug`：独立路径的一部分，发布后尽量保持不变。
- `name`、`englishName`、`description`、`type`、`status`：只填可以核实的信息。`status` 描述作品体验入口，不描述本轮改版已经上线。
- `experience`：包含 `href`、`label`、`description`。入口不确定时设为 `null`，体验章节与按钮隐藏。`secondaryExperience` 和可选 `source` 也只放已确认的公开链接。
- `contentState`：现有三个作品均为 `introduction`（简洁介绍）。收到完整材料后可改为 `full-story`。
- `chapters`：默认为空。可用 `id` 为 `origin`（创作起点）、`work`（我的工作）、`process`（过程与取舍）、`next`（接下来的想法）。每项包含纯文本 `body` 和 `confirmed`；只有 `confirmed: true` 且正文非空才生成章节。段落使用两个换行分隔。未确认正文不会进入浏览器配置。

可选章节格式：

```json
{"id": "origin", "body": "作者确认后的真实内容。", "confirmed": true}
```

当前作品沿用 `src/partials/*-cover.html` 中的原站视觉预览，标明为插画、示意或光效预览；终端示意不代表真实连接成功。2026-10-23已采集各应用浏览器验收截图，保存在本机忽略的 `artifacts/` 目录；未擅自选为公开作品封面。实际终端连接及公开截图选择仍需相应环境与作者确认。

收到真实截图后，放入 `src/assets/projects/`，在对应作品中添加：

```json
"preview": {
  "src": "/assets/projects/actual-preview.png",
  "alt": "准确描述截图中的作品和状态",
  "caption": "准确描述截图来源"
}
```

截图会同时用于首页和介绍页。现有分享封面是 1200×630 的文字图形 PNG，独立于作品截图，位于 `src/assets/projects/*-share.png`。修改作品名后可在有系统 Cairo 的环境运行 `python3 scripts/export-share-covers.py` 更新封面；普通构建直接使用已提供的 PNG，不依赖 Cairo。介绍页已有独立标题、摘要、canonical、Open Graph 封面与 sitemap 条目。

## 更新记录

首页与 `/updates/` 共用 `updates` 数组。当前真实记录为空。首页不出现更新卡片，独立更新页显示空状态。

1. 复制 `content/updates.example.json` 中的对象至 `updates` 数组。示例文件本身不参与构建。
2. 保持 `published: false`，填写真实标题、说明和事件日期。日期使用 `YYYY-MM-DD`；不要填文件修改时间来代替事件日期。草稿日期可保持 `null`。
3. `type` 只能是 `新作品`、`改进`、`创作记录`。关联链接 `link` 可删除或设为 `null`，有链接时填 `href`、`label`。
4. 核实内容和发布安排后，将 `published` 改为 `true` 并重新构建。缺失、无效或未来日期会阻止发布构建。
5. 编辑原条目后重新构建即可更新；撤回时改回 `false` 并重新构建，无须删除内容。

首页最多显示最近三条，独立页按真实日期倒序显示全部已发布记录。同日记录按内容文件中的顺序排列。发布构建不会复制示例、草稿和内部资料清单到公开目录。本地预览完成不等于已上线，不要写成上线公告。

## 作者与联系

`author` 保存安全默认介绍 `introduction`、关注方向 `focus`、代表作品标识 `featuredProjects` 和联系文案 `contactText`。原有创作理念继续来自 `site.json` 的 `about`。

公开名称、邮箱、GitHub、城市、坐标、时区继续由 `site.json` 管理，当前邮箱为 `jim@strgo.com`。空 GitHub、城市或坐标自然隐藏；时区仍可显示。未填写个人信息不会显示“待配置”。活动矩阵在没有真实贡献数据时明确标为示例，指标保留“设计目标 / 非实测”标记。

`author.collaboration` 默认为 `null`，收到作者认可的合作说明后再填写。`author.now` 默认为 `null`；只有 `{ "text": "已确认的当前事项", "confirmed": true }` 才显示“正在创作”，可选 `href` 关联实际内容。不要把未来设想写成正在进行。

复制邮箱失败时原按钮会提示手动保存的真实邮箱，页面同时保留 `mailto:` 链接。

## 2026-10-23 补验

`node tests/content-browser.mjs` 在Chrome155通过375/768/1440宽度、筛选路线、作品直达/刷新、复制失败反馈、原空间入口与横向溢出检查，每轮18张截图。早期两次在复制提示检查超时，补齐返回首页后的交互就绪等待及失败诊断后连续两轮完整通过；未据此宣称真实设备性能或线上已发布。当前结果见 `artifacts/requirements-v1/browser/results.json`。
