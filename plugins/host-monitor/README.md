# 主机资源监控

在 Paseo 侧栏查看 daemon 宿主机的 CPU、内存、磁盘和网络，点击状态条打开紧凑浮窗，查看前 5 个进程并进入资源详情；进程内存为 RSS。桌面浮窗由宿主限制宽度至 420px，手机使用底部抽屉。功能、采样口径和限制见 [OVERVIEW.md](OVERVIEW.md)。

基于 [a31521424/paseo-kit](https://github.com/a31521424/paseo-kit) 的 host-monitor 插件开发，保留原项目 Apache-2.0 许可证及来源归属。

## 安装

需要 Paseo 0.13.2 或更高版本，并在 daemon 中启用插件。进程采样需要 Linux；进程网络需要 `ss`，NVIDIA 进程指标需要 `nvidia-smi`，结束进程需要支持 pidfd 的 Linux 和 Python 3。

安装前禁用原版插件，避免同时显示两个状态条；保留原版以便回滚：

```bash
paseo plugin disable host-monitor
```

从本 fork 的功能分支安装，插件 ID 为 `paseo-resource-usage-monitor`：

```bash
paseo plugin install github:sc1994/paseo-resource-usage-monitor:plugins/host-monitor --ref feat/process-resource-panel
```

也可从本地仓库安装：

```bash
cd plugins/host-monitor
npm ci
paseo plugin install "$PWD"
```

原版 `host-monitor` 保持禁用，无需移除或重启 daemon。PR 合并前，普通 `paseo plugin update paseo-resource-usage-monitor` 会跟随仓库默认 `main`，不是本功能分支；需要更新分支时显式指定 `--ref feat/process-resource-panel`。

回滚时禁用本插件并重新启用原版：

```bash
paseo plugin disable paseo-resource-usage-monitor
paseo plugin enable host-monitor
```

## 开发与验证

在 `plugins/host-monitor` 目录中运行：

```bash
npm ci
npm run typecheck
npm test
paseo plugin reload paseo-resource-usage-monitor
paseo plugin logs paseo-resource-usage-monitor
```

测试使用 Node.js 22 的类型剥离功能。重载插件不需要重启 daemon。
