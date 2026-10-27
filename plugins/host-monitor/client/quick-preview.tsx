import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { compactBytes, formatCompactRate, formatPercent } from "./format";
import { orderProcesses, type ProcessResources, type ProcessGroup } from "./process-order";
import { useProcessState } from "./process-state";
import { memoryPercent, sumDisks, useHostStats } from "./stats";

const previewKeys = ["cpu", "memory", "download", "upload"] as const;

export function HostQuickPreview({ theme, host, openScreen }: PluginPopoverProps) {
  const stats = useHostStats();
  const { query, data, labels, disabled, activeSort, activeDirection, groups, changeSort } = useProcessState(host.id);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const fg = theme.colors.foreground;
  const muted = theme.colors.foregroundMuted;
  const current = stats.data;
  const pct = (value: number | null) => value === null ? "--" : `${value.toFixed(1)}%`;
  return <View style={{ width: 396, maxWidth: "100%", minWidth: 0, gap: 4 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, color: fg, fontWeight: "600", fontSize: 14 }}>{current?.hostname ?? host.label}</Text>
      <Text style={{ color: muted, fontSize: 11 }}>{stats.isError ? "主机采样失败" : current ? "每 2 秒更新" : "正在采样"}</Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", minHeight: 40, paddingVertical: 4 }}>
      {current ? [
        `CPU ${formatPercent(current.current.cpuPercent)}`,
        `内存 ${formatPercent(memoryPercent(current.memory))}`,
        `磁盘 ${current.disks.length ? formatPercent(sumDisks(current.disks).percent) : "--"}`,
        `网络 ${current.network ? `↓${formatCompactRate(current.current.rxBytesPerSec)} ↑${formatCompactRate(current.current.txBytesPerSec)}/s` : "--"}`,
      ].map((text, index) => <Text key={index} numberOfLines={1} style={{ width: "50%", minHeight: 16, color: muted, fontSize: 11 }}>{text}</Text>) : <Text style={{ color: muted, fontSize: 11 }}>主机数据暂不可用</Text>}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text style={{ flex: 1, minWidth: 0, color: muted, fontSize: 11 }}>进程</Text>
      {previewKeys.map((key) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${labels[key]}排序${activeSort === key ? activeDirection === "desc" ? "降序" : "升序" : ""}`} accessibilityState={{ disabled: disabled(key) }} disabled={disabled(key)} onPress={() => changeSort(key)} style={{ width: key === "download" || key === "upload" ? 54 : 48, minHeight: 44, justifyContent: "center", alignItems: "flex-end", opacity: disabled(key) ? 0.5 : 1 }}>
        <Text style={{ color: activeSort === key ? theme.colors.accent : muted, fontSize: 11 }}>{labels[key]}{activeSort === key ? activeDirection === "desc" ? "↓" : "↑" : ""}</Text>
      </Pressable>)}
    </View>
    {data && (activeSort === "gpu" || activeSort === "gpuMemory" || activeSort === "network") ? <Text style={{ color: muted, fontSize: 11 }}>当前按{labels[activeSort]}{activeDirection === "desc" ? "降序" : "升序"}</Text> : null}
    {data && query.isError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>刷新失败，显示上次采样结果。</Text> : null}
    {!data && query.isPending ? <Text style={{ color: muted, paddingVertical: 8 }}>正在采集进程数据</Text> : null}
    {!data && query.isError ? <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Text style={{ color: theme.colors.statusDanger }}>进程采集失败</Text><Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: theme.colors.accent }}>重试</Text></Pressable></View> : null}
    {data && !groups.length ? <Text style={{ color: muted, paddingVertical: 8 }}>暂无进程数据</Text> : null}
    {data ? groups.slice(0, 5).map((group) => {
      const opened = expanded.has(group.name);
      const multi = group.members.length > 1;
      const fields: (keyof ProcessResources)[] = ["cpuPercent", "memoryBytes", "rxBytesPerSec", "txBytesPerSec"];
      const values = (usage: ProcessResources, partial?: ProcessGroup["partial"]) => fields.map((field, i) => {
        const value = usage[field];
        const formatted = i === 0 ? pct(value) : value === null ? "--" : `${compactBytes(value)}${i >= 2 ? "/s" : ""}`;
        return `${value !== null && partial?.has(field) ? "≥" : ""}${formatted}`;
      });
      const cells = (usage: ProcessResources, partial?: ProcessGroup["partial"]) => values(usage, partial).map((value, i) => <Text key={previewKeys[i]} style={{ width: i >= 2 ? 54 : 48, textAlign: "right", color: fg, fontSize: 10, fontVariant: ["tabular-nums"] }}>{value}</Text>);
      const toggle = () => setExpanded((previous) => { const next = new Set(previous); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); return next; });
      return <View key={group.name}>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 45, borderBottomWidth: 1, borderColor: theme.colors.border }}>
          {multi ? <Pressable accessibilityRole="button" accessibilityLabel={`${group.name}，${group.members.length}个进程`} accessibilityState={{ expanded: opened }} aria-expanded={opened} onPress={toggle} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" }}><Text numberOfLines={1} style={{ color: fg, fontSize: 12 }}>{opened ? "▾" : "▸"} {group.name}</Text><Text style={{ color: muted, fontSize: 10 }}>{group.members.length}个进程</Text></Pressable> : <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: fg, fontSize: 12 }}>{group.name}</Text><Text style={{ color: muted, fontSize: 10 }}>PID {group.members[0].pid}</Text></View>}
          {cells(group.usage, group.partial)}
        </View>
        {multi && opened ? orderProcesses(group.members, activeSort, activeDirection).map((process) => <View key={`${process.pid}:${process.startTime}`} style={{ flexDirection: "row", alignItems: "center", minHeight: 35, paddingLeft: 8, borderBottomWidth: 1, borderColor: theme.colors.border }}><View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: muted, fontSize: 10 }}>PID {process.pid}</Text><Text numberOfLines={1} style={{ color: muted, fontSize: 10 }}>{process.user}</Text></View>{cells(process)}</View>) : null}
      </View>;
    }) : null}
    <Pressable accessibilityRole="button" onPress={() => openScreen({ screenId: "resources", params: { tab: "process" } })} style={{ minHeight: 44, justifyContent: "center", alignItems: "flex-end" }}><Text style={{ color: theme.colors.accent, fontSize: 12 }}>查看资源详情 →</Text></Pressable>
  </View>;
}
