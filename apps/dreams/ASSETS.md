# 素材清单

所有艺术素材均为无字图片，不含重复标题、编号、卡片框或按钮。来源为项目内确定性 Canvas 绘画代码 `scripts/paintings.js`，种子 4217；重建命令 `npm run art`。没有使用电影截图、第三方照片、远端图库或 AI 图像生成 API。工作区未提供原始设计 PNG。

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `assets/art/hero.webp` | 2400 × 720 | 桌面后备花园，正常模式使用实时 3D |
| `assets/art/hero-mobile.webp` | 720 × 1240 | 手机后备画境构图 |
| `assets/art/themes.webp` | 2400 × 640 | 后备睡莲池背景；正常模式使用实时 3D |
| `assets/art/paper.webp` | 512 × 512 | 固定纸纹 |
| `assets/art/dream-01.webp` … `dream-08.webp` | 各 640 × 840 | 八张 design 模式章节画、画廊与主题小图 |
| `assets/art/film-01.webp` … `film-08.webp` | 各 640 × 840 | 独立的 film 模式章节画 |
| `assets/favicon.svg` | 矢量 | 红色夢字印章 |
| `src/icons.js` | 内联 SVG | 原创细线界面图标 |

20 张画作与纸纹的尺寸、大小和 SHA256 见 `assets/manifest.json`。五张主题图按数据引用已确认章节画，不重复存储。

3D 地形、路径、隧道、房屋、桥梁、人物、树、花、叶、非矩形花瓣与鸟由 `src/world.js` 程序化建模，主题睡莲池的叶与花由 `src/pond.js` 建模。绘画材质纹理与远景天空在运行时用 Canvas 生成；实时水域与反射由 `src/water.js` 生成，没有 glTF 模型、额外在线纹理或未声明外部素材。它们是项目的风格化视觉解释，不宣称为黑泽明、莫奈或梵高的原作。

| 第三方文件 | 固定版本 | 来源与许可 |
|---|---|---|
| `assets/vendor/three.module.js` | 0.160.1 | npm `three`，MIT |
| `assets/vendor/OrbitControls.js` | 同 Three.js | Three.js examples，MIT；仅将导入改为本地路径 |
| `assets/vendor/Reflector.js` | 同 Three.js | Three.js examples，MIT；运行时扩展局部水纹 shader |
| `assets/vendor/THREE-LICENSE.txt` | — | 原许可原文 |

开发验证依赖 `playwright-core`、`linkedom` 与 `@napi-rs/canvas`，版本与完整性固定于 `package-lock.json`；不随静态网页加载。使用系统字体，不分发字体文件。声音由 Web Audio 合成，无外部录音素材。
