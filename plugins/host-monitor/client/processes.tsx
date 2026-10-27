import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { processStatsRpc, terminateProcessRpc, type GpuMode, type ProcessStats, type ProcessUsage } from "../shared/processes";
import { formatBytes, formatRate } from "./format";
import { networkTotal, orderProcesses, type SortDirection, type SortKey } from "./process-order";
import { loadColor } from "./stats";

type FocusTarget = View & { focus?: () => void };
const keys: SortKey[] = ["cpu", "memory", "gpu", "network"];
const percentage = (value: number | null) => value === null ? "--" : `${value.toFixed(1)}%`;
const rate = (value: number | null) => value === null ? "--" : formatRate(value);
const memory = (value: number | null) => value === null ? "--" : formatBytes(value);
function gpuValue(process: ProcessUsage, mode: GpuMode): string {
  if (mode === "memory") return process.gpuMemoryBytes === null ? "--" : formatBytes(process.gpuMemoryBytes);
  return mode === "utilization" ? percentage(process.gpuPercent) : "--";
}

export function ProcessPanel({ theme, compact }: { theme: PluginTheme; compact: boolean }) {
  const getProcesses = useRpc(processStatsRpc);
  const terminate = useRpc(terminateProcessRpc);
  const [selected, setSelected] = useState<ProcessUsage | null>(null);
  const [frozen, setFrozen] = useState<ProcessStats | null>(null);
  const [sort, setSort] = useState<SortKey>("cpu");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const cancelRef = useRef<FocusTarget>(null);
  const sortRef = useRef<FocusTarget>(null);
  const query = useQuery({
    queryKey: ["host-processes"], queryFn: () => getProcesses({}),
    enabled: selected === null, refetchInterval: selected === null ? 2000 : false,
  });
  const mutation = useMutation({ mutationFn: terminate });
  const data = frozen ?? query.data;
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
  const changeSort = (key: SortKey) => {
    if (selected) return;
    if (sort === key) setDirection(direction === "desc" ? "asc" : "desc");
    else { setSort(key); setDirection("desc"); }
  };
  const fg = theme.colors.foreground;
  const muted = theme.colors.foregroundMuted;
  const border = theme.colors.border;
  const labels: Record<SortKey, string> = { cpu: "CPU", memory: "内存", gpu: data?.capabilities.gpu.mode === "memory" ? "GPU显存" : data?.capabilities.gpu.mode === "utilization" ? "GPU利用率" : "GPU", network: "网络" };
  const disabled = (key: SortKey) => key === "cpu" ? !data?.capabilities.cpu.available : key === "memory" ? !data?.processes.some((process) => process.memoryBytes !== null) : key === "gpu" ? data?.capabilities.gpu.mode === "unavailable" : !data?.capabilities.network.available;
  const activeSort = disabled(sort) ? keys.find((key) => !disabled(key)) ?? "cpu" : sort;
  const activeDirection = activeSort === sort ? direction : "desc";
  const rows = data ? orderProcesses(data.processes, activeSort, activeDirection, data.capabilities.gpu.mode).slice(0, 12) : [];
  const sortButtons = keys.map((key) => (
    <Pressable key={key} ref={key === activeSort ? sortRef : undefined} accessibilityRole="button"
      accessibilityLabel={`${labels[key]}排序${activeSort === key ? activeDirection === "desc" ? "降序" : "升序" : ""}`}
      accessibilityState={{ disabled: disabled(key) || !!selected }} disabled={disabled(key) || !!selected}
      onPress={() => changeSort(key)}
      style={{ minHeight: compact ? 44 : 32, justifyContent: "center", paddingHorizontal: 2, opacity: disabled(key) ? 0.5 : 1 }}>
      <Text style={{ color: activeSort === key ? theme.colors.accent : muted, fontSize: 12 }}>
        {labels[key]} {activeSort === key ? activeDirection === "desc" ? "↓" : "↑" : "↕"}
      </Text>
    </Pressable>
  ));
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: fg, fontSize: 14, fontWeight: "600" }}>高占用进程</Text>
          {data ? <Text style={{ color: muted, fontSize: 12 }}>{Math.min(data.processes.length, 12)} / {data.processes.length}</Text> : null}</View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails(!showDetails)} style={{ minHeight: compact ? 44 : 32, justifyContent: "center" }}><Text style={{ color: theme.colors.accent, fontSize: 12 }}>采集说明 {showDetails ? "↑" : "↓"}</Text></Pressable>
      </View>
      {data && showDetails ? <View style={{ gap: 3, paddingVertical: 8 }}>
        <Text style={{ color: muted, fontSize: 12 }}>-- 表示数据不可用。CPU 100% 表示占用 1 个核心。内存为 RSS，可能包含共享页，各进程相加不等于主机已用内存。网络为可归属的可见 TCP 持续连接上下行总速率，不含 UDP 和短连接。</Text>
        {!data.capabilities.cpu.available ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>CPU：{data.capabilities.cpu.reason ?? "不可用"}</Text> : null}
        {data.capabilities.gpu.reason ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>GPU：{data.capabilities.gpu.reason}</Text> : null}
        {data.capabilities.gpu.mode === "unavailable" && !data.capabilities.gpu.reason ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>GPU 进程采集不可用</Text> : null}
        {data.capabilities.network.reason ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>网络：{data.capabilities.network.reason}</Text> : null}
        {!data.capabilities.network.available && !data.capabilities.network.reason ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>网络进程采集不可用</Text> : null}
        {!data.capabilities.release.available ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>释放：{data.capabilities.release.reason ?? "不可用"}</Text> : null}
        {rows.filter((process) => !process.canTerminate && process.protectionReason).map((process) => <Text key={`${process.pid}:${process.startTime}`} style={{ color: muted, fontSize: 12 }}>PID {process.pid} · {process.name}：{process.protectionReason}</Text>)}
      </View> : null}
      {data && query.isError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>进程刷新失败，显示上次采样结果。</Text> : null}
      {!data && query.isPending ? <Text style={{ color: muted }}>正在采集进程数据</Text> : null}
      {!data && query.isError ? <View style={{ gap: 8 }}><Text style={{ color: theme.colors.statusDanger }}>进程采集失败</Text><Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={{ color: theme.colors.accent }}>重试</Text></Pressable></View> : null}
      {data ? <>
        <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: border }}>
          {!compact ? <Text style={{ flex: 2, color: muted, fontSize: 12 }}>进程</Text> : <Text style={{ color: muted, fontSize: 12 }}>排序</Text>}
          {compact ? sortButtons : keys.map((key, index) => <View key={key} style={{ flex: key === "network" ? 1.6 : 1, alignItems: "flex-end" }}>{sortButtons[index]}</View>)}
          {!compact ? <Text style={{ width: 62, textAlign: "right", color: muted, fontSize: 12 }}>操作</Text> : null}
        </View>
        {rows.length === 0 ? <Text style={{ color: muted }}>暂无进程数据</Text> : rows.map((process) => {
          const allowed = process.canTerminate && data.capabilities.release.available;
          const reason = process.protectionReason ?? data.capabilities.release.reason ?? "不可结束";
          const resources: Record<SortKey, string> = { cpu: percentage(process.cpuPercent), memory: memory(process.memoryBytes), gpu: gpuValue(process, data.capabilities.gpu.mode), network: rate(networkTotal(process)) };
          const action = <View style={{ alignItems: "flex-end", width: compact ? 64 : 62 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`释放 ${process.name}，PID ${process.pid}${allowed ? "" : `，${reason}`}`}
              disabled={!allowed || !!selected} onPress={() => { setFrozen(data); setSelected({ ...process }); setResult(""); }}
              style={{ minHeight: compact ? 44 : 28, minWidth: 56, alignItems: "center", justifyContent: "center", borderWidth: allowed ? 1 : 0, borderColor: border, borderRadius: 4 }}>
              <Text style={{ color: allowed ? fg : muted, fontSize: 12 }}>{allowed ? "释放" : process.protectionReason === "非当前用户进程" ? "无权限" : process.protectionReason === "受保护的系统或服务进程" ? "受保护" : "受限"}</Text>
            </Pressable>
          </View>;
          const identity = <View style={{ flex: 2, minWidth: 0 }}><Text numberOfLines={1} style={{ color: fg, fontSize: 13, fontWeight: "600" }}>{process.name}</Text><Text style={{ color: muted, fontSize: 11 }}>PID {process.pid} · {process.user}</Text></View>;
          const cells = keys.map((key) => <View key={key} style={{ flex: compact ? undefined : key === "network" ? 1.6 : 1, width: compact ? "50%" : undefined, minWidth: 0, alignItems: compact ? "flex-start" : "flex-end" }}>
            <Text numberOfLines={1} style={{ color: key === "cpu" && process.cpuPercent !== null && process.cpuPercent >= 70 ? loadColor(theme, process.cpuPercent) : key === "gpu" && data.capabilities.gpu.mode === "utilization" && process.gpuPercent !== null && process.gpuPercent >= 70 ? loadColor(theme, process.gpuPercent) : fg, fontSize: 12, fontVariant: ["tabular-nums"] }}>{compact ? `${labels[key]} ` : ""}{resources[key]}</Text>
            {key === "network" && networkTotal(process) !== null ? <Text style={{ color: muted, fontSize: 10, fontVariant: ["tabular-nums"], textAlign: compact ? "left" : "right" }}>↓ {rate(process.rxBytesPerSec)} · ↑ {rate(process.txBytesPerSec)}</Text> : null}
          </View>);
          return <View key={`${process.pid}:${process.startTime}`} style={{ minHeight: compact ? 64 : 40, paddingVertical: compact ? 3 : 2, borderBottomWidth: 1, borderColor: border }}>
            {compact ? <><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{identity}{action}</View><View style={{ flexDirection: "row", flexWrap: "wrap" }}>{cells}</View></> : <View style={{ flexDirection: "row", alignItems: "center" }}>{identity}{cells}{action}</View>}
          </View>;
        })}
      </> : null}
      {result ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.accent, fontSize: 12 }}>{result}</Text> : null}
      <Modal title="结束进程并释放资源？" open={selected !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <Modal.Content>
          <Text style={{ color: theme.colors.statusWarning }}>将中断该进程正在执行的任务，未保存的数据可能丢失。</Text>
          {selected && data ? <View style={{ gap: 8 }}>
            <Text style={{ color: fg }}>进程：{selected.name} · PID {selected.pid}</Text>
            <Text style={{ color: fg }}>用户：{selected.user}</Text>
            <Text selectable style={{ color: fg }}>命令：{selected.command}</Text>
            <Text style={{ color: fg }}>资源：CPU {percentage(selected.cpuPercent)} · 内存 {memory(selected.memoryBytes)} · {labels.gpu} {gpuValue(selected, data.capabilities.gpu.mode)} · 网络 {rate(networkTotal(selected))}</Text>
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
