# 资源、模型与授权

| 资源 | 固定版本 / 来源 | 本地位置 | 授权 |
| --- | --- | --- | --- |
| Three.js | 0.160.1，来自已安装 npm 包原文件 | `assets/three.module.js` | MIT，附 `assets/THREE-LICENSE.txt` |
| 圆润展示字体回退 | DejaVu Sans Bold，本机字体包 | `assets/meow-display.ttf` | 附 `assets/FONT-LICENSE.txt` |
| 角色、关节、毛束、皮肤与花纹 | 本项目程序化创作，无外部模型 | `modules/cat-model.js` / `batch-model.js` | 本项目 MIT |
| 猫窝、杯子、包、小鱼、毛线、帽衫与摆件 | 本项目程序化创作 | `modules/props.js` | 本项目 MIT |
| 界面图标与 favicon | 本项目 SVG 路径 | `modules/views.js` / `assets/favicon.svg` | 本项目 MIT |
| 14 猫、5 画廊、7 商品、1 主场景预览 | 实际程序化模型的 EGL 离线渲染 | `assets/previews/*.png` | 本项目 MIT |

没有外链模型、远程猫咪图片、外部字体请求、音乐或默认播放声音。PNG 只用于卡片和明确标识的静态降级；实时主体由真正的三维网格构成。

模型清单 `artifacts/model-manifest.json` 逐只记录稳定角色 ID、类型 ID、形态预设、毛长、动作、网格三角形数、draw 数与关节数。高低两档保留形态差异，低档合并更多刚性部件并减少毛束。几何批处理保留头、眼睛、前爪、尾部和配饰的独立控制状态。每个活动实例独立创建几何、材质与动作状态，并按所属实例释放。

模型文件格式为运行时程序化几何，不存在未交付的 `luna.glb` 等占位链接；纹理花纹使用顶点颜色，长毛为实际轮廓毛束，斯芬克斯为褶皱网格。没有对外宣称已完成最终手工雕刻、蒙皮或影视级毛发资产。

## 重建预览和对照

```bash
npm run previews
python3 scripts/coverage.py
node scripts/record-models.mjs
```

预览需要本机 `/opt/google/chrome/libEGL.so` 与 `libGLESv2.so`，脚本只使用 Python 标准库，不是生产运行依赖。生产站点已打包全部 PNG。

同一相机、灰色材质、去配饰的六个检查图为 `artifacts/gray-milk.png`、`gray-luna.png`、`gray-atlas.png`、`gray-milo.png`、`gray-tiger.png`、`gray-suki.png`；汇总为 `artifacts/gray-comparison.svg`。它们是几何诊断图，不是浏览器截图。

## 参考范围

品种外形与技术接口的参考入口沿用需求提供的 CFA、Three.js 与 MDN 官方资料。角色、毛色组合、故事和动作是创作设定，不根据插画断言真实血统。当前 Three.js 接口也按本地固定版本源码检查；没有把远程站点的可变最新版当作 r160 的保证。

- CFA Breeds: https://cfa.org/breeds/
- CFA Ragdoll: https://cfa.org/breed/ragdoll/
- CFA Maine Coon: https://cfa.org/breed/maine-coon-cat/
- CFA Sphynx: https://cfa.org/breed/sphynx/
- Three.js docs: https://threejs.org/docs/
- MDN reduced motion: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

原始参考图在本次消息中只有 `REFERENCE_IMAGE` 占位标记，未收到可读取的图片文件。视觉依据用户给出的版式、颜色、内容与形态规格制作，未宣称完成对原图的逐像素还原。
