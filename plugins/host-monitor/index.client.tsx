import type { PluginClientContext } from "@getpaseo/plugin/client";
import { HostMonitorScreen, HostStatusItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "resources", title: "主机资源监控", Component: HostMonitorScreen });
  client.addSidebarFooterItem({ id: "host-status", title: "主机状态", Component: HostStatusItem });
  return () => {};
}
