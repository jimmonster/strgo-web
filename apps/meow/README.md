# Meow · Pink Cat Paradise

粉色猫咪天堂的可运行静态前端，工程位于 `/root/meow`。应用独立构建；主站提供桌面 MEOW 导航、手机菜单和第七张粉色空间卡片，均指向 `/meow/`。入口源码已更新，需单独发布主站才在线上显示。

首页包含真实 HTML 糖果标题、粉色云朵、Milk 大蝴蝶结猫、周边五只不同类型的猫咪，以及 Popular Cats / Cat Gallery / Cat Shop 三块面板。内容包含 12 类、14 只数字角色、5 个画廊作品、7 个演示商品与所有主要导航页面。

## 启动

已附 `dist/` 静态产物，运行不需要下载模型、图片、字体或调用外部服务。

```bash
cd /root/meow
npm run build
npm run dev
```

访问 `http://127.0.0.1:4173/`。深层地址如 `/cats/milk/`、`/gallery/bubble-wave/`、`/shop/paw-mug/` 有各自的目录 `index.html`，支持直接打开与刷新。使用 HTTP，不要双击 HTML 文件预览 ES 模块。

安装测试依赖时使用锁定文件：

```bash
npm ci
npm run check
npm run test:browser
```

## 已实现的前端流程

- 14 个猫咪档案：各自的名字、类型、体态、毛长、花纹、眼睛与独立程序化模型；旋转、缩放、相机复位、姿态复位、配饰与三种环境选择。
- 头部、左右前爪、身体、尾部代理拾取；鼠标拖动与点击分离；动作按钮提供文本等价操作。触屏点“开始观察”后可以拖动、双指缩放，并可退出观察继续滚动。
- 基础呼吸、眨眼、转头、转耳、摆尾；摸头、碰爪、挥爪、玩具、踩奶、翻身、伸展、行走、睡姿等按角色提供；快速点击替换当前动作，暂停时主动操作播放一次后回到暂停。
- Cats 按品类、毛长、基础毛色、花纹、收藏与中英文关键词筛选，条件保存在查询参数中；无结果状态不偷偷回退为全部。
- 五个独立画廊场景、上一条下一条、收藏、静态预览切换、暂停、相机控制和导出当前 WebGL 渲染画面。
- 七个独立商品、四个分类；配色、尺寸或样式选择与数量；加入相同商品规格合并数量，购物清单支持调整、删除、清空与文本导出。不配置价格或虚构付款。
- 分类收藏、本地昵称头像与品类偏好、订阅意向、消息草稿、数字云陪伴纪念卡、示例社区与本地留言、照护主题收藏、本地 JSON 导入导出。
- 版本化存储、损坏记录保留、未知版本导出、数量与 ID 校验、写入失败提示、多个页面与标签页读取相同记录。
- 一个可复用 WebGL 渲染器，切换场景清理旧循环、监听、几何、材质与观察器；后台与离屏停止更新；系统减少动态效果与全局暂停控制 CSS 和三维时间。

## 子目录部署

```bash
MEOW_BASE=/meow/ npm run build
MEOW_BASE=/meow/ npm run dev
```

此时访问 `http://127.0.0.1:4173/meow/`。`MEOW_BASE` 只接受 `/` 或以 `/` 结尾的安全子目录。已知详情不需要 SPA 回退规则。

正式目标为 `https://strgo.com/meow/`，当前 `dist/` 已按 `/meow/` 构建。在服务器普通 SSH / Workbench 终端执行：

```bash
bash /root/meow/deploy.sh
```

脚本自动构建、生成独立 Nginx 片段、保留原配置备份并原子切换版本，校验全部页面和资源、目录重定向、自定义 404 与其他站点响应；失败自动尝试回滚。服务器记录显示 2026-10-16 已发布版本 `20261016T060953Z-23858`，状态为 `deployed-local-verified`。新增首页入口还需在普通终端执行 `bash /root/strgo-homepage/deploy.sh`。完整步骤、诊断与回滚说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 实现与资源

使用原生 HTML / CSS / JavaScript、Three.js **0.160.1**。源代码在 `app.js`、`styles.css` 和 `modules/`，静态页面由 `scripts/build.mjs` 预生成。依赖版本固定在 `package.json` / `package-lock.json`。

角色是程序化几何与独立关节层级，具有完整头颈、躯干、耳朵、四肢、尾巴、球面眼睛、鼻头、爪垫和胡须。长短毛使用几何毛束与不同轮廓，Suki 使用皮肤褶皱。没有把一张图贴在平面上充当三维，也没有声称使用不存在的 GLB / SkinnedMesh 美术资源。

所有缩略图来自同一套实际模型的离线 EGL 几何渲染；它们是静态预览，照明与浏览器 Three.js 材质渲染不同，不能当作浏览器截图。详情默认使用实时 WebGL；不可用时明确显示静态预览与重试。

模型与授权记录见 [ASSETS.md](ASSETS.md)、[artifacts/model-manifest.json](artifacts/model-manifest.json)，构建后也有 `dist/assets/model-manifest.json`。实际角色和页面地址见 [ROUTES.md](ROUTES.md)。

## 验收状态与限制

源码、静态构建、数据、DOM、实际应用静态降级、模型体积与关节动作检查已执行，记录见 [ACCEPTANCE.md](ACCEPTANCE.md) 和 `artifacts/test-report.json`。

当前沙箱禁止本地 socket，HTTP 服务启动返回 `listen EPERM 127.0.0.1:4173`，因此**真实 HTTP / Chromium 桌面与手机验收尚未执行通过**。对应脚本与阻断记录已交付，不把离屏图片当作浏览器验收结果。

主视觉猫体几何蒙版约 **73.3%**，依据是 `artifacts/hero-cat-mask.png` 与 `coverage-diagnostic.json`；这是主场景的实际猫体联合面积，排除了背景、猫窝和容器。**最终桌面首屏 70% 的 A04 仍待截图测量**，因为完整页面还包含 HTML 遮挡、卡片、页脚与视口裁切。真实帧率、连续切换后的 GPU 内存及九宫格动效覆盖也待浏览器验收。

所有角色和商品均为虚构创作。本地体验档案不是身份认证；订阅不发送邮件；消息不自动发送；云陪伴不是现实领养。数据只在当前浏览器保存，可在本地数据设置里导出、导入或恢复默认。
