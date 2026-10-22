# 本次交付状态

日期：2026 年 10 月 14 日。

- 工作目录：`/root/strgo-homepage`。
- 生成页面：`dist/index.html`；原版银河备份：`dist/archive/index.html`。
- 七个指定组件、全局光学令牌和性能守卫已实现。
- `npm run build`：通过，离线预览模式。
- `node --check dist/assets/main.js` 与源码模块语法检查：通过。
- `npm test`：10 项 Node + 4 项 Python 通过。
- `npm run test:gpu`：生产粒子 GLSL 编译、链接与绘制通过，无 GL 错误。
- 桌面 1440×900：2500 粒子，6500 个发光像素；鼠标排斥/高亮改变 3457 个像素。
- 移动 390×844：850 粒子，891 个发光像素；鼠标着色器测试改变 1470 个像素。实际移动端交互会禁用鼠标作用。
- 真实浏览器检查：未完成。Chrome 启动时因 `setsockopt: Operation not permitted` 退出；没有网页截图可据以声明视觉验收通过。
- 正式依赖安装：未完成。在线安装因 DNS/网络不可用失败，离线安装因 Lenis 缓存缺失失败。测试工具从已有 npm 缓存安装成功。
- GSAP/Lenis/canvas-confetti 正式分支：代码已接入，尚未真实运行验收；当前预览使用原生回退。
- 邮箱、GitHub、城市坐标：原配置为空。页面明确标注对应缺失与演示数据，未编造资料。
- 线上发布、Nginx 修改、Git 合入：未执行。原目录只读，本次生成的是独立可审查工作副本。

下一步可在普通终端执行 `npm install && npm run build:production && npm test && npm run test:browser`。完成浏览器验收后，已有 `deploy.sh` 可以发布新版；缺少正式依赖时发布会停止。
