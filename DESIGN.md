# STRGO Orbit 视觉系统

本系统统一 STRGO 的操作界面及跨空间导航，依据现有星环门户的深色与薄荷绿方向，使用 [Impeccable](https://github.com/pbakaus/impeccable) 的 extract、harden、audit、polish 指引整理。它不是页面模板，也不替代各个三维空间的作品风格。

## 视觉权威与源码

- 唯一颜色、间距和圆角来源：`content/app-registry.json` 的 `tokens`。主构建生成 `/hub/tokens.css`，独立应用把同一套资源打包至自己的 `_strgo/`。
- 共享字族、浏览器表面、焦点和控件规则：`src/shared/design-system.css`。Latin 使用本地 Space Grotesk 可变字体，中文使用设备的苹方或微软雅黑；终端保持自身文字排版和等宽终端字体。
- 图标：`src/shared/icons.js`，24 × 24、1.65 px 描边的 SVG；装饰性的三维世界保留原有资产。
- 共享搜索、收藏、最近访问与安全 API：`src/shared/catalog.js`。`src/hub/core.js` 保留兼容导出。
- 终端由独立 Rust 服务提供，`scripts/sync-terminal-theme.mjs` 将同一套 token 嵌入现有两份 CSS；`--check` 检查漂移，不引入跨站脚本或全局快捷键。

## 颜色与结构

背景 `bg`，主表面 `surface`，抬高表面 `surface-raised`，输入区 `input`；正文 `text`，次要文字 `muted`，分隔线 `border`。薄荷绿 `accent` 只用于主操作、当前项和焦点，按钮文字使用 `accent-ink`；错误用 `danger/danger-soft`，提醒用 `warning`，AI 分类可用 `violet`。不能用“在线”色点假装服务已经连接。

操作界面默认 15 px 正文、1.65 行高，移动端主要正文与输入框 16 px；标题保持清晰层级，主要阅读正文不超过 70ch。控件至少 44 px 高，次要标签最小 12 px。常规面板圆角 14 px，控件 10 px，空间封面可以保留原有结构。

首页与空间属于 Experience；作品场景保留日光、梦境、粉色猫咪和虫族等主题。工具、社区和后台属于 Operate：保留熟悉的布局，减少装饰，突出任务与当前状态。内容页属于 Read：保留作品内容和清晰的阅读顺序。

## 交互契约

功能切换器可从主页、社区、创作工具、后台及各个沉浸空间打开。Ctrl/⌘ K、方向键、Enter 和单次 Esc 可操作；关闭后焦点回到触发器。终端继续使用原来的直接返回入口，避免拦截终端键盘。Workflow 在自己的域名使用独立会话，导航不读取共享账号 Cookie。

收藏与最近访问沿用按账号分隔的本机存储，切换器与门户使用同一份数据。存储不可用时反馈“本次仍可使用”，不会宣称已保存。未登录、加载、空列表、错误、禁用和权限不足均显示独立状态。

系统减少动效偏好优先于装饰动画。主站星环是主要的动态表达；操作界面只用短暂的颜色反馈，不对所有章节重复进入动画。

## 可访问性与发布

保留键盘焦点、对话框语义、原生输入、可读错误信息和私有内容清理。客户端不提升权限，所有编辑、评论、删除和已读操作都由原共享账号 API 校验身份与 CSRF。

主要色对的静态对比检查、实际浏览器记录及外部验收边界见 `doc/IMPECCABLE-UPGRADE.md`。源码和 GitHub 提交不代表生产部署；域名、线上服务与默认主页配置沿用原规则。
