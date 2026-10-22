# 素材清单

| 文件或内容 | 来源 / 形式 | 使用方式 |
| --- | --- | --- |
| `assets/three.module.js` | Three.js 0.160.1，MIT | 本地固定版本模块，约 655KB |
| `assets/THREE-LICENSE.txt` | Three.js 原始 MIT 许可 | 随分发保留 |
| `assets/favicon.svg` | 项目原创 SVG | 轨道行星图标 |
| `assets/galaxies.svg` | 项目原创程序化 SVG | 第一张卡片，无标题与边框烘焙 |
| `assets/destinations.svg` | 项目原创程序化 SVG | 第二张卡片，工业环形空间站 |
| `assets/technology.svg` | 项目原创程序化 SVG | 第三张卡片，环形行星 |
| `assets/homeworld.svg` | 项目原创程序化 SVG | 第四张卡片，异星地表与宇航员 |
| 巨行星、星场、星云、月球 | `src/shaders.js` 程序化材质 | 实时可扭曲后景，无照片依赖 |
| 黑洞 | 自定义 GLSL，多层流纹、核心遮挡、光弧与透镜 | 独立实时合成，无静止底图旋涡 |
| 空间站、宇航员、飞船、栏杆 | `src/foreground.js` 程序化 Three.js 几何 | 按材质合并、灯光与引擎独立更新 |
| 全息图 | CSS 和内联 SVG | 扫描、球面线框、波形与少量展示数据 |
| 环境音 | 浏览器 Web Audio 合成 | 无外部录音，默认关闭 |
| 中文字体 | 本机 Noto Sans CJK / 微软雅黑 / 苹方 / sans-serif | 无远端字体请求，具体字形随系统变化 |
| 图标 | 项目内联 SVG symbol | 无外部图标请求 |

`python3 scripts/generate-assets.py` 可按固定种子重新生成原创 SVG 卡片图景。SVG 只用于卡片预览，不包含主界面文案。没有使用参考图裁切，也没有生成整页截图作为背景。

开发依赖：Playwright Core 1.59.1，LinkeDOM 0.18.12。依赖使用各自原始许可，详见安装后的包目录。交互演示数据集中于 `src/content-data.js`，目的地的未来基地、可用航线、飞行时间及页面统计均不代表真实服务。
