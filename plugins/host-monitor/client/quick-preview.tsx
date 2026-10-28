import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { sumDisks } from "../shared/stats";
import { compactBytes, formatCompactRate, formatPercent } from "./format";
import { orderProcesses, type ProcessResources, type ProcessGroup } from "./process-order";
import { useProcessState } from "./process-state";
import { memoryPercent, scaleToPeak, Sparkline, useHostStats } from "./stats";

const previewKeys = ["cpu", "memory", "download", "upload"] as const;

export function HostQuickPreview({ theme, host, layout, openScreen }: PluginPopoverProps) {
  const stats = useHostStats();
  const { query, data, labels, disabled, activeSort, activeDirection, groups, changeSort } = useProcessState(host.id);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [width, setWidth] = useState(396);
  const [bodyWidth, setBodyWidth] = useState<number | undefined>();
  const { height } = useWindowDimensions();
  const fg = theme.colors.foreground;
  const muted = theme.colors.foregroundMuted;
  const current = stats.data;
  const narrow = width < 350;
  const columnWidths = narrow ? [46, 46, 46, 46] : [48, 48, 54, 54];
  const pct = (value: number | null) => value === null ? "--" : `${value.toFixed(1)}%`;
  const history = current?.history.slice(-24) ?? [];
  const metrics = current ? [
    { label: "CPU", value: formatPercent(current.current.cpuPercent), values: history.map((sample) => sample.cpuPercent), color: muted },
    { label: "内存", value: formatPercent(memoryPercent(current.memory)), values: history.map((sample) => sample.memoryPercent), color: muted },
    { label: "磁盘", value: current.disks.length ? formatPercent(sumDisks(current.disks).percent) : "--", values: history.flatMap((sample) => sample.diskPercent === null ? [] : [sample.diskPercent]), color: muted },
    { label: "网络", value: current.network ? `↓${formatCompactRate(current.current.rxBytesPerSec)}/s\n↑${formatCompactRate(current.current.txBytesPerSec)}/s` : "--", values: scaleToPeak(history, (sample) => sample.rxBytesPerSec + sample.txBytesPerSec), color: theme.colors.accent },
  ] : [];

  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[{ minWidth: 0, gap: 4 }, layout.compact ? { width: "100%", flex: 1, minHeight: 0 } : { width: 396, maxWidth: "100%", height: Math.max(0, Math.min(376, height - 120)) }]}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, color: fg, fontWeight: "600", fontSize: 14 }}>{current?.hostname ?? host.label}</Text>
      {stats.isError || !current ? <Text style={{ color: muted, fontSize: 11 }}>{stats.isError ? "主机采样失败" : "正在采样"}</Text> : null}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 6, paddingVertical: 4 }}>
      {current ? metrics.map((metric) => <View key={metric.label} style={{ width: "50%", minWidth: 0, flexDirection: "row", alignItems: "flex-end", paddingRight: 6 }}>
        <View style={{ minWidth: 0, flexShrink: 1, flexDirection: narrow ? "column" : "row", alignItems: narrow ? "flex-start" : "flex-end", gap: narrow ? 0 : 4 }}>
          <Text style={{ color: muted, fontSize: 11 }}>{metric.label}</Text>
          <Text style={{ color: fg, fontSize: 11, fontVariant: ["tabular-nums"] }}>{metric.value}</Text>
        </View>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 52, minWidth: 32, maxWidth: 96, marginLeft: 8 }}><Sparkline values={metric.values} color={metric.color} height={18} /></View>
      </View>) : <Text style={{ color: muted, fontSize: 11 }}>主机数据暂不可用</Text>}
    </View>
    <View style={{ width: bodyWidth, maxWidth: "100%", flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text style={{ flex: 1, minWidth: 0, color: muted, fontSize: 11 }}>进程</Text>
      {previewKeys.map((key, index) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${labels[key]}排序${activeSort === key ? activeDirection === "desc" ? "降序" : "升序" : ""}`} accessibilityState={{ disabled: disabled(key) }} disabled={disabled(key)} onPress={() => changeSort(key)} style={{ width: columnWidths[index], flexShrink: 0, minHeight: 44, justifyContent: "center", alignItems: "flex-end", opacity: disabled(key) ? 0.5 : 1 }}>
        <Text style={{ color: activeSort === key ? theme.colors.accent : muted, fontSize: 11 }}>{labels[key]}{activeSort === key ? activeDirection === "desc" ? "↓" : "↑" : ""}</Text>
      </Pressable>)}
    </View>
    <ScrollView style={{ flex: 1, minHeight: 0 }} showsVerticalScrollIndicator>
      <View onLayout={(event) => setBodyWidth(event.nativeEvent.layout.width)} style={{ minWidth: 0 }}>
        {data && (activeSort === "gpu" || activeSort === "gpuMemory" || activeSort === "network") ? <Text style={{ color: muted, fontSize: 11 }}>当前按{labels[activeSort]}{activeDirection === "desc" ? "降序" : "升序"}</Text> : null}
        {data && query.isError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>刷新失败，显示上次采样结果。</Text> : null}
        {!data && query.isPending ? <Text style={{ color: muted, paddingVertical: 8 }}>正在采集进程数据</Text> : null}
        {!data && query.isError ? <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Text style={{ color: theme.colors.statusDanger }}>进程采集失败</Text><Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: theme.colors.accent }}>重试</Text></Pressable></View> : null}
        {data && !groups.length ? <Text style={{ color: muted, paddingVertical: 8 }}>暂无进程数据</Text> : null}
        {data ? groups.slice(0, 5).map((group) => {
          const opened = expanded.has(group.name);
          const multi = group.members.length > 1;
          const fields: (keyof ProcessResources)[] = ["cpuPercent", "memoryBytes", "rxBytesPerSec", "txBytesPerSec"];
          const cells = (usage: ProcessResources, partial?: ProcessGroup["partial"]) => fields.map((field, i) => {
            const value = usage[field];
            const formatted = i === 0 ? pct(value) : value === null ? "--" : `${compactBytes(value)}${i >= 2 ? "/s" : ""}`;
            return <Text key={previewKeys[i]} style={{ width: columnWidths[i], flexShrink: 0, textAlign: "right", color: fg, fontSize: 10, fontVariant: ["tabular-nums"] }}>{value !== null && partial?.has(field) ? "≥" : ""}{formatted}</Text>;
          });
          const toggle = () => setExpanded((previous) => { const next = new Set(previous); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); return next; });
          return <View key={group.name}>
            <View style={{ flexDirection: "row", alignItems: "center", minHeight: 45, borderBottomWidth: 1, borderColor: theme.colors.border }}>
              {multi ? <Pressable accessibilityRole="button" accessibilityLabel={`${group.name}，${group.members.length}个进程`} accessibilityState={{ expanded: opened }} aria-expanded={opened} onPress={toggle} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" }}><Text numberOfLines={1} style={{ color: fg, fontSize: 12 }}>{opened ? "▾" : "▸"} {group.name}</Text><Text style={{ color: muted, fontSize: 10 }}>{group.members.length}个进程</Text></Pressable> : <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: fg, fontSize: 12 }}>{group.name}</Text><Text style={{ color: muted, fontSize: 10 }}>PID {group.members[0].pid}</Text></View>}
              {cells(group.usage, group.partial)}
            </View>
            {multi && opened ? orderProcesses(group.members, activeSort, activeDirection).map((process) => <View key={`${process.pid}:${process.startTime}`} style={{ flexDirection: "row", alignItems: "center", minHeight: 35, paddingLeft: 8, borderBottomWidth: 1, borderColor: theme.colors.border }}><View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: muted, fontSize: 10 }}>PID {process.pid}</Text><Text numberOfLines={1} style={{ color: muted, fontSize: 10 }}>{process.user}</Text></View>{cells(process)}</View>) : null}
          </View>;
        }) : null}
      </View>
    </ScrollView>
    <Pressable accessibilityRole="button" onPress={() => openScreen({ screenId: "resources", params: { tab: "process" } })} style={{ minHeight: 44, justifyContent: "center", alignItems: "flex-end" }}><Text style={{ color: theme.colors.accent, fontSize: 12 }}>查看资源详情 →</Text></Pressable>
  </View>;
}
