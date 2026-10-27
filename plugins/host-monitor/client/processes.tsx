import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { terminateProcessRpc, type ProcessStats, type ProcessUsage } from "../shared/processes";
import { formatBytes, formatRate } from "./format";
import { networkTotal, orderProcesses, type ProcessGroup, type ProcessResources } from "./process-order";
import { processKeys as keys, useProcessState } from "./process-state";
import { loadColor } from "./stats";

type FocusTarget = View & { focus?: () => void };
const percentage = (value: number | null) => value === null ? "--" : `${value.toFixed(1)}%`;
const rate = (value: number | null) => value === null ? "--" : formatRate(value);
const memory = (value: number | null) => value === null ? "--" : formatBytes(value);

export function ProcessPanel({ theme, compact, hostId }: { theme: PluginTheme; compact: boolean; hostId: string }) {
  const terminate = useRpc(terminateProcessRpc);
  const [selected, setSelected] = useState<ProcessUsage | null>(null);
  const [frozen, setFrozen] = useState<ProcessStats | null>(null);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const cancelRef = useRef<FocusTarget>(null);
  const sortRef = useRef<FocusTarget>(null);
  const { query, data, labels, disabled, activeSort, activeDirection, groups, changeSort } = useProcessState(hostId, selected === null, frozen);
  const mutation = useMutation({ mutationFn: terminate });
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => cancelRef.current?.focus?.(), 100);
    return () => clearTimeout(timer);
  }, [selected]);

  const close = () => {
    if (mutation.isPending) return;
    setSelected(null);
    setFrozen(null);
    setMessage("");
    setBlocked(false);
    setTimeout(() => sortRef.current?.focus?.(), 100);
  };
  const confirm = async () => {
    if (!selected || mutation.isPending || blocked) return;
    setMessage("");
    try {
      const response = await mutation.mutateAsync({ pid: selected.pid, startTime: selected.startTime });
      if (response.status === "terminated" || response.status === "already_exited") {
        setResult(response.status === "terminated" ? "进程已退出，资源变化以重新采样为准。" : "进程已退出，无需重复结束。");
        close();
        void query.refetch();
      } else {
        const prefix = response.status === "identity_changed" ? "进程身份已变化，请刷新后重新选择。" :
          response.status === "still_running" ? "已发送结束请求，但进程仍未退出。" : "无法结束进程。";
        setMessage(`${prefix} ${response.message}`);
        if (response.status === "identity_changed" || response.status === "still_running") setBlocked(true);
      }
    } catch (error) {
      setMessage(`请求失败，请重试或取消。${error instanceof Error ? ` ${error.message}` : ""}`);
    }
  };
  const fg = theme.colors.foreground;
  const muted = theme.colors.foregroundMuted;
  const border = theme.colors.border;
  const rows = groups.slice(0, 12);
  const sortButtons = keys.map((key) => {
    const sortKey = key === "network" && (activeSort === "download" || activeSort === "upload") ? activeSort : key;
    const active = sortKey === activeSort;
    const label = key === "network" && sortKey !== "network" ? `网络（${labels[sortKey]}）` : labels[key];
    return <Pressable key={key} ref={active ? sortRef : undefined} accessibilityRole="button"
      accessibilityLabel={`${label}排序${active ? activeDirection === "desc" ? "降序" : "升序" : ""}`}
      accessibilityState={{ disabled: disabled(sortKey) || !!selected }} disabled={disabled(sortKey) || !!selected}
      onPress={() => changeSort(sortKey)}
      style={{ minHeight: compact ? 44 : 32, minWidth: compact ? 44 : undefined, justifyContent: "center", paddingHorizontal: 2, opacity: disabled(sortKey) ? 0.5 : 1 }}>
      <Text style={{ color: active ? theme.colors.accent : muted, fontSize: 12 }}>
        {label} {active ? activeDirection === "desc" ? "↓" : "↑" : "↕"}
      </Text>
    </Pressable>;
  });
  const renderProcess = (process: ProcessUsage, indented = false) => {
    if (!data) return null;
    const allowed = process.canTerminate && data.capabilities.release.available;
    const reason = process.protectionReason ?? data.capabilities.release.reason ?? "不可结束";
    const resources: Record<(typeof keys)[number], string> = { cpu: percentage(process.cpuPercent), memory: memory(process.memoryBytes), gpu: percentage(process.gpuPercent), gpuMemory: memory(process.gpuMemoryBytes), network: rate(networkTotal(process)) };
    const action = <View style={{ alignItems: "flex-end", width: compact ? 64 : 62 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`释放 ${process.name}，PID ${process.pid}${allowed ? "" : `，${reason}`}`}
        disabled={!allowed || !!selected} onPress={() => { setFrozen(data); setSelected({ ...process }); setResult(""); }}
        style={{ minHeight: compact ? 44 : 28, minWidth: 56, alignItems: "center", justifyContent: "center", borderWidth: allowed ? 1 : 0, borderColor: border, borderRadius: 4 }}>
        <Text style={{ color: allowed ? fg : muted, fontSize: 12 }}>{allowed ? "释放" : process.protectionReason === "非当前用户进程" ? "无权限" : process.protectionReason === "受保护的系统或服务进程" ? "受保护" : "受限"}</Text>
      </Pressable>
    </View>;
    const identity = <View style={{ flex: 2, minWidth: 0 }}><Text numberOfLines={1} style={{ color: fg, fontSize: 13, fontWeight: "600" }}>{process.name}</Text><Text style={{ color: muted, fontSize: 11 }}>PID {process.pid} · {process.user}</Text></View>;
    const cells = keys.map((key) => <View key={key} style={{ flex: compact ? undefined : key === "network" ? 1.6 : 1, width: compact ? "50%" : undefined, minWidth: 0, alignItems: compact ? "flex-start" : "flex-end" }}>
      <Text numberOfLines={1} style={{ color: key === "cpu" && process.cpuPercent !== null && process.cpuPercent >= 70 ? loadColor(theme, process.cpuPercent) : key === "gpu" && process.gpuPercent !== null && process.gpuPercent >= 70 ? loadColor(theme, process.gpuPercent) : fg, fontSize: 12, fontVariant: ["tabular-nums"] }}>{compact ? `${labels[key]} ` : ""}{resources[key]}</Text>
      {key === "network" && (process.rxBytesPerSec !== null || process.txBytesPerSec !== null) ? <Text style={{ color: muted, fontSize: 10, fontVariant: ["tabular-nums"], textAlign: compact ? "left" : "right" }}>↓ {rate(process.rxBytesPerSec)} · ↑ {rate(process.txBytesPerSec)}</Text> : null}
    </View>);
    return <View key={`${process.pid}:${process.startTime}`} style={{ minHeight: compact ? 64 : 40, paddingVertical: compact ? 3 : 2, paddingLeft: indented ? 12 : 0, borderBottomWidth: 1, borderColor: border }}>
      {compact ? <><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{identity}{action}</View><View style={{ flexDirection: "row", flexWrap: "wrap" }}>{cells}</View></> : <View style={{ flexDirection: "row", alignItems: "center" }}>{identity}{cells}{action}</View>}
    </View>;
  };
  const renderGroup = (group: ProcessGroup) => {
    if (group.members.length === 1) return <View key={group.name}>{renderProcess(group.members[0])}</View>;
    const opened = expanded.has(group.name);
    const field = (name: keyof ProcessResources, format: (n: number | null) => string) => `${group.usage[name] !== null && group.partial.has(name) ? "≥" : ""}${format(group.usage[name])}`;
    const rx = group.usage.rxBytesPerSec, tx = group.usage.txBytesPerSec;
    const total = networkTotal(group.usage);
    const networkPartial = total !== null && (group.partial.has("rxBytesPerSec") || group.partial.has("txBytesPerSec"));
    const values: Record<(typeof keys)[number], string> = { cpu: field("cpuPercent", percentage), memory: field("memoryBytes", memory), gpu: field("gpuPercent", percentage), gpuMemory: field("gpuMemoryBytes", memory), network: `${networkPartial ? "≥" : ""}${rate(total)}` };
    const toggle = () => setExpanded((previous) => { const next = new Set(previous); if (next.has(group.name)) next.delete(group.name); else next.add(group.name); return next; });
    const identity = <Pressable accessibilityRole="button" accessibilityLabel={`${group.name}，${group.members.length}个进程`} accessibilityState={{ expanded: opened, disabled: !!selected }} aria-expanded={opened} disabled={!!selected} onPress={toggle} style={{ flex: 2, minWidth: 0, minHeight: 44, justifyContent: "center" }}>
      <Text numberOfLines={1} style={{ color: fg, fontSize: 13, fontWeight: "600" }}>{opened ? "▾" : "▸"} {group.name}</Text><Text style={{ color: muted, fontSize: 11 }}>{group.members.length}个进程</Text>
    </Pressable>;
    const cells = keys.map((key) => <View key={key} style={{ flex: compact ? undefined : key === "network" ? 1.6 : 1, width: compact ? "50%" : undefined, minWidth: 0, alignItems: compact ? "flex-start" : "flex-end" }}>
      <Text style={{ color: fg, fontSize: 12, fontVariant: ["tabular-nums"] }}>{compact ? `${labels[key]} ` : ""}{values[key]}</Text>
      {key === "network" && (rx !== null || tx !== null) ? <Text style={{ color: muted, fontSize: 10 }}>↓ {field("rxBytesPerSec", rate)} · ↑ {field("txBytesPerSec", rate)}</Text> : null}
    </View>);
    return <View key={group.name}><View style={{ minHeight: 44, paddingVertical: 2, borderBottomWidth: 1, borderColor: border }}>
      {compact ? <>{identity}<View style={{ flexDirection: "row", flexWrap: "wrap" }}>{cells}</View></> : <View style={{ flexDirection: "row", alignItems: "center" }}>{identity}{cells}<View style={{ width: 62 }} /></View>}
    </View>{opened ? orderProcesses(group.members, activeSort, activeDirection).map((process) => renderProcess(process, true)) : null}</View>;
  };
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: fg, fontSize: 14, fontWeight: "600" }}>高占用进程</Text>
          {data ? <Text style={{ color: muted, fontSize: 12 }}>{Math.min(groups.length, 12)} / {groups.length}组 · {data.processes.length}个进程</Text> : null}</View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails(!showDetails)} style={{ minHeight: compact ? 44 : 32, justifyContent: "center" }}><Text style={{ color: theme.colors.accent, fontSize: 12 }}>采集说明 {showDetails ? "↑" : "↓"}</Text></Pressable>
      </View>
      {data && showDetails ? <View style={{ gap: 3, paddingVertical: 8 }}>
        <Text style={{ color: muted, fontSize: 12 }}>-- 表示数据不可用，≥ 表示部分成员已知值之和。CPU 100% 表示占用 1 个核心。内存为 RSS，可能包含共享页，各进程相加不等于主机已用内存。网络为可归属的可见 TCP 持续连接上下行总速率，不含 UDP 和短连接。</Text>
        {!data.capabilities.cpu.available ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>CPU：{data.capabilities.cpu.reason ?? "不可用"}</Text> : null}
        {!data.capabilities.gpu.utilization.available ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>GPU利用率：{data.capabilities.gpu.utilization.reason ?? "不可用"}</Text> : null}
        {!data.capabilities.gpu.memory.available ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>GPU显存：{data.capabilities.gpu.memory.reason ?? "不可用"}</Text> : null}
        {data.capabilities.network.reason ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>网络：{data.capabilities.network.reason}</Text> : null}
        {!data.capabilities.network.available && !data.capabilities.network.reason ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>网络进程采集不可用</Text> : null}
        {!data.capabilities.release.available ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>释放：{data.capabilities.release.reason ?? "不可用"}</Text> : null}
        {data.processes.filter((process) => !process.canTerminate && process.protectionReason).map((process) => <Text key={`${process.pid}:${process.startTime}`} style={{ color: muted, fontSize: 12 }}>PID {process.pid} · {process.name}：{process.protectionReason}</Text>)}
      </View> : null}
      {data && query.isError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>进程刷新失败，显示上次采样结果。</Text> : null}
      {!data && query.isPending ? <Text style={{ color: muted }}>正在采集进程数据</Text> : null}
      {!data && query.isError ? <View style={{ gap: 8 }}><Text style={{ color: theme.colors.statusDanger }}>进程采集失败</Text><Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={{ color: theme.colors.accent }}>重试</Text></Pressable></View> : null}
      {data ? <>
        <View style={{ flexDirection: "row", flexWrap: compact ? "wrap" : "nowrap", alignItems: "center", borderBottomWidth: 1, borderColor: border }}>
          {!compact ? <Text style={{ flex: 2, color: muted, fontSize: 12 }}>进程</Text> : <Text style={{ color: muted, fontSize: 12 }}>排序</Text>}
          {compact ? sortButtons : keys.map((key, index) => <View key={key} style={{ flex: key === "network" ? 1.6 : 1, alignItems: "flex-end" }}>{sortButtons[index]}</View>)}
          {!compact ? <Text style={{ width: 62, textAlign: "right", color: muted, fontSize: 12 }}>操作</Text> : null}
        </View>
        {rows.length === 0 ? <Text style={{ color: muted }}>暂无进程数据</Text> : rows.map(renderGroup)}
      </> : null}
      {result ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.accent, fontSize: 12 }}>{result}</Text> : null}
      <Modal title="结束进程并释放资源？" open={selected !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <Modal.Content>
          <Text style={{ color: theme.colors.statusWarning }}>将中断该进程正在执行的任务，未保存的数据可能丢失。</Text>
          {selected && data ? <View style={{ gap: 8 }}>
            <Text style={{ color: fg }}>进程：{selected.name} · PID {selected.pid}</Text>
            <Text style={{ color: fg }}>用户：{selected.user}</Text>
            <Text selectable style={{ color: fg }}>命令：{selected.command}</Text>
            <Text style={{ color: fg }}>资源：CPU {percentage(selected.cpuPercent)} · 内存 {memory(selected.memoryBytes)} · GPU利用率 {percentage(selected.gpuPercent)} · GPU显存 {memory(selected.gpuMemoryBytes)} · 网络 {rate(networkTotal(selected))}</Text>
          </View> : null}
          {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.statusDanger }}>{message}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable ref={cancelRef} accessibilityRole="button" disabled={mutation.isPending} onPress={close} style={{ padding: 12, borderWidth: 1, borderColor: border, borderRadius: 6 }}><Text style={{ color: fg }}>取消</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={mutation.isPending || blocked} onPress={() => void confirm()} style={{ padding: 12, borderWidth: 1, borderColor: theme.colors.statusDanger, borderRadius: 6, opacity: mutation.isPending || blocked ? 0.5 : 1 }}><Text style={{ color: theme.colors.statusDanger }}>{mutation.isPending ? "正在结束…" : "结束进程"}</Text></Pressable>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
