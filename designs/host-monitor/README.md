# Host monitor 交互设计稿

上游项目：https://github.com/a31521424/paseo-kit，插件目录为 `plugins/host-monitor`。本地复制基线为 `14e6ac03d78c7430c054894557062426acd3f2e9`，用户 fork 为 https://github.com/sc1994/paseo-resource-usage-monitor。原项目 Apache-2.0 许可证及 NOTICE 保持不变。

直接打开 `index.html` 即可预览，无外部依赖。所有数据均为示例，页面不会采样主机、发送请求或操作真实进程；正式插件待设计确认后开发。现有插件只采集主机总量，没有进程、GPU 或终止进程 RPC。

官方 `openPopover` 宽屏为锚定弹层，compact 模式为底部抽屉。本设计桌面左侧展示主机概览和磁盘分区，右侧展示高占用进程；窄屏通过“主机概览 / 进程”切换，可置于底部抽屉。CPU、GPU、网络列均可切换升降序；网络按下载与上传合计排序，CPU 100% 代表一个核心。不可用数据始终排在最后，同值按 PID 排序。GPU 或网络不可用时，进程区说明原因并禁用对应排序，CPU 仍可排序。预览状态选择器可查看采集和释放异常。

“释放”表示结束进程，可能中断任务并丢失未保存数据；示例仅模拟操作。守护进程受保护，不能释放。确认框支持取消、Esc 和失败重试；示例进程已退出时移除该行，提示无需重复结束。浏览器控制台可运行 `hostMonitorSelfCheck()`，检查升降序、不可用值排序与受保护进程；断言失败会抛错。

未来实际开发需按现有模式涉及 `client/sidebar.tsx`、`shared/stats.ts`、`server/sampler.ts`、`index.server.ts`。必须校验操作权限和进程身份，避免 PID 重用导致误杀；GPU 信息受驱动及平台能力限制，进程网络归因也依赖平台和权限，不保证所有环境均可采集。
