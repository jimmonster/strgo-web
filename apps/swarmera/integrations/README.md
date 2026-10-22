# STRGO 首页接入

当前主站源码已同步修改并成功构建。`strgo-homepage/` 中记录本次修改的三个文件，便于检查与迁移：

- `src/index.html`：空间入口第八张 SWARMERA 卡片、移动导航链接。
- `src/assets/globals.css`：紫色虫甲卡片与手机布局。
- `deploy.sh`：保留 SWARMERA Nginx include，发布后验证应用实际内容。

这些文件是本次工作环境的完整文件快照。现有主站后续有其他修改时，请合并 SWARMERA 标记处的改动，不要用旧快照覆盖新内容。当前环境无需再复制；运行 `/root/swarmera/deploy.sh` 会依次发布应用与已更新的主站源码。
