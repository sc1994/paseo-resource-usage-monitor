import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { diskPercent, gpuHistory, sumDisks, type hostStatsRpc } from "../shared/stats";
import { ProcessPanel } from "./processes";
import { HostQuickPreview } from "./quick-preview";
import { formatBytes, formatCompactRate, formatPercent, formatRate, formatUptime } from "./format";
import {
  Meter,
  Sparkline,
  loadColor,
  memoryPercent,
  memorySeverity,
  percentSeverity,
  scaleToPeak,
  severityColor,
  useHostStats,
  type Severity,
} from "./stats";

// Geometry follows the built-in usage summary in the same footer.
const ICON_SIZE = 14;
const FONT_SIZE = 12;
const ICON_GAP = 6;
const METRIC_GAP = 10;
const MIN_METER_WIDTH = 16;
const METER_GAP = 4;
const METER_HEIGHT = 6;
// Between the download and upload numbers that share one icon.
const PAIR_SEPARATOR = "/";
const PAIR_SEPARATOR_WIDTH = 8;

type HostStats = RpcOutput<typeof hostStatsRpc>;

type MetricKey = "cpu" | "memory" | "disk" | "network";

/** Which metrics fit, and whether the percentages get meters. */
interface LineLayout {
  shown: readonly Metric[];
  meters: boolean;
}

interface Metric {
  key: MetricKey;
  icon: string;
  /** One number, or two (download and upload) sharing the icon. */
  texts: readonly string[];
  percent?: number;
  /** Sets the color of a metric with a percent. */
  severity?: Severity;
}

// On a narrow sidebar, network goes first, then disk; CPU and RAM always stay.
const DROP_ORDER: readonly MetricKey[] = ["network", "disk"];

function metricsOf(stats: HostStats): Metric[] {
  const { current, memory, network, disks } = stats;
  const ram = memoryPercent(memory);
  const metrics: Metric[] = [
    {
      key: "cpu",
      icon: "Cpu",
      texts: [formatPercent(current.cpuPercent)],
      percent: current.cpuPercent,
      severity: percentSeverity(current.cpuPercent),
    },
    {
      key: "memory",
      icon: "MemoryStick",
      texts: [formatPercent(ram)],
      percent: ram,
      severity: memorySeverity(memory),
    },
  ];
  if (disks.length > 0) {
    const { percent } = sumDisks(disks);
    metrics.push({
      key: "disk",
      icon: "HardDrive",
      texts: [formatPercent(percent)],
      percent,
      severity: percentSeverity(percent),
    });
  }
  if (network) {
    metrics.push({
      key: "network",
      icon: "ArrowDownUp",
      texts: [formatCompactRate(current.rxBytesPerSec), formatCompactRate(current.txBytesPerSec)],
    });
  }
  return metrics;
}

// The widest text a slot can hold: rounded percents top out at 100%, compact rates at 4 characters.
const SLOT_TEMPLATES = ["100%", "888K", "8.8M"];
// Used until the templates are measured.
const ESTIMATED_SLOT_WIDTH = FONT_SIZE * 2.6;
const TEXT_GAP = 4;

function MetricLine({
  theme,
  layout,
  slotWidth,
}: {
  theme: PluginTheme;
  layout: LineLayout;
  slotWidth: number;
}) {
  return layout.shown.map((metric, index) => {
    const metered = layout.meters && metric.percent !== undefined;
    const valueColor =
      metric.severity !== undefined && metric.severity !== "normal"
        ? severityColor(theme, metric.severity)
        : theme.colors.foreground;
    const textStyle = { color: valueColor, fontSize: FONT_SIZE, fontVariant: ["tabular-nums" as const] };
    const [first, second] = metric.texts;
    return (
      <View
        key={metric.key}
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginLeft: index === 0 ? 0 : METRIC_GAP,
          // Meter slots share the leftover width, so the line fills the row.
          flexGrow: metered ? 1 : 0,
          flexShrink: metered ? 1 : 0,
        }}
      >
        <Icon name={metric.icon} size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        {metered ? (
          <Meter
            theme={theme}
            percent={metric.percent ?? 0}
            severity={metric.severity}
            height={METER_HEIGHT}
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: MIN_METER_WIDTH, marginLeft: ICON_GAP }}
          />
        ) : null}
        {/* Fixed slots: changing digits never move anything around them. A lone number sits
            right-aligned; a pair hugs the separator between them. */}
        <Text
          numberOfLines={1}
          style={[textStyle, { width: slotWidth, marginLeft: metered ? METER_GAP : TEXT_GAP, textAlign: "right" }]}
        >
          {first}
        </Text>
        {second !== undefined ? (
          <>
            <Text
              style={{
                width: PAIR_SEPARATOR_WIDTH,
                textAlign: "center",
                color: theme.colors.foregroundMuted,
                fontSize: FONT_SIZE,
              }}
            >
              {PAIR_SEPARATOR}
            </Text>
            <Text numberOfLines={1} style={[textStyle, { width: slotWidth, textAlign: "left" }]}>
              {second}
            </Text>
          </>
        ) : null}
      </View>
    );
  });
}

/** Width of a meterless line; depends only on fixed sizes, never on values. */
function lineWidth(metrics: readonly Metric[], slotWidth: number): number {
  let width = Math.max(metrics.length - 1, 0) * METRIC_GAP;
  for (const { texts } of metrics) {
    width += ICON_SIZE + TEXT_GAP + texts.length * slotWidth + (texts.length - 1) * PAIR_SEPARATOR_WIDTH;
  }
  return width;
}

/** Meters when everything fits, else plain numbers; when neither fits, drop a metric and retry. */
function chooseLayout(available: number | null, metrics: readonly Metric[], slotWidth: number): LineLayout {
  let shown = metrics;
  if (available === null) return { shown, meters: false };
  for (const drop of [...DROP_ORDER, null]) {
    const plain = lineWidth(shown, slotWidth);
    const meterCount = shown.filter((m) => m.percent !== undefined).length;
    if (plain + meterCount * (ICON_GAP + MIN_METER_WIDTH + METER_GAP - TEXT_GAP) <= available) {
      return { shown, meters: true };
    }
    if (plain <= available || drop === null) return { shown, meters: false };
    shown = shown.filter((m) => m.key !== drop);
  }
  return { shown, meters: false };
}

function triggerStyle(theme: PluginTheme) {
  return ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => ({
    width: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
    minHeight: 28,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: hovered ? theme.colors.surface2 : undefined,
  });
}

function describe(stats: HostStats): string {
  const { current, memory, network, disks } = stats;
  const parts = [
    `CPU ${formatPercent(current.cpuPercent)}`,
    `内存 ${formatPercent(memoryPercent(memory))}`,
  ];
  if (memory.pressure) parts.push(`内存压力 ${memory.pressure}`);
  if (disks.length > 0) parts.push(`磁盘 ${formatPercent(sumDisks(disks).percent)}`);
  if (network) {
    parts.push(
      `下载 ${formatRate(current.rxBytesPerSec)}`,
      `上传 ${formatRate(current.txBytesPerSec)}`,
    );
  }
  return `主机状态：${parts.join("，")}`;
}

function layoutWidth(event: LayoutChangeEvent): number {
  return event.nativeEvent.layout.width;
}

export function HostStatusItem({ theme, host, layout: hostLayout, openPopover, openScreen }: PluginSidebarItemProps) {
  const { data } = useHostStats();
  const [modalOpen, setModalOpen] = useState(false);
  const [available, setAvailable] = useState<number | null>(null);
  const [measuredSlot, setMeasuredSlot] = useState<number | null>(null);
  useEffect(() => {
    if (!hostLayout.compact) setModalOpen(false);
  }, [hostLayout.compact]);
  const onAvailable = useCallback((e: LayoutChangeEvent) => setAvailable(layoutWidth(e)), []);
  const onTemplate = useCallback((e: LayoutChangeEvent) => {
    const width = Math.ceil(layoutWidth(e));
    setMeasuredSlot((current) => Math.max(current ?? 0, width));
  }, []);

  // Like the built-in usage summary: nothing until there is something to show.
  if (!data) return null;
  const metrics = metricsOf(data);
  const slotWidth = measuredSlot ?? ESTIMATED_SLOT_WIDTH;
  const layout = chooseLayout(available, metrics, slotWidth);

  return (
    <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={describe(data)}
      onPress={() => hostLayout.compact ? setModalOpen(true) : openPopover(HostQuickPreview)}
      style={triggerStyle(theme)}
    >
      <View
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", overflow: "hidden" }}
        onLayout={onAvailable}
      >
        <MetricLine theme={theme} layout={layout} slotWidth={slotWidth} />
      </View>
      {/* Off-screen templates fix the slot width once, independent of live values. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", top: 0, left: 0, width: 10_000, opacity: 0 }}
      >
        {SLOT_TEMPLATES.map((template) => (
          <Text
            key={template}
            onLayout={onTemplate}
            style={{ alignSelf: "flex-start", fontSize: FONT_SIZE, fontVariant: ["tabular-nums"] }}
          >
            {template}
          </Text>
        ))}
      </View>
    </Pressable>
    <Modal title="主机状态" open={hostLayout.compact && modalOpen} onOpenChange={setModalOpen}>
      <Modal.Content scrollable={false} contentContainerStyle={{ padding: 12, gap: 0 }}>
        <HostQuickPreview
          theme={theme}
          host={host}
          layout={hostLayout}
          close={() => setModalOpen(false)}
          openScreen={(input) => { setModalOpen(false); openScreen(input); }}
        />
      </Modal.Content>
    </Modal>
    </>
  );
}

interface PreviewRowProps {
  theme: PluginTheme;
  icon: string;
  label: string;
  value: string;
  color: string;
  values: readonly number[];
  /** A muted line under the label. */
  detail?: string;
}

function PreviewRow({ theme, icon, label, value, color, values, detail }: PreviewRowProps) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
        <Icon name={icon} size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>
          {label}
        </Text>
        <Text
          style={{ color: theme.colors.foreground, fontSize: FONT_SIZE, fontVariant: ["tabular-nums"] }}
        >
          {value}
        </Text>
      </View>
      {detail ? <Caption theme={theme} text={detail} /> : null}
      <Sparkline values={values} color={color} height={18} />
    </View>
  );
}

function Caption({ theme, text }: { theme: PluginTheme; text: string }) {
  return (
    <Text
      style={{ paddingLeft: ICON_SIZE + ICON_GAP, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE - 1 }}
    >
      {text}
    </Text>
  );
}

/** macOS: what the RAM figure leaves out, and the pressure that colors it. */
function memoryDetail(memory: HostStats["memory"]): string | undefined {
  const parts: string[] = [];
  if (memory.cachedBytes !== null) parts.push(`缓存文件 ${formatBytes(memory.cachedBytes)}`);
  if (memory.pressure !== null) parts.push(`压力 ${memory.pressure}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function DiskSection({ theme, disks }: { theme: PluginTheme; disks: HostStats["disks"] }) {
  const total = sumDisks(disks);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
        <Icon name="HardDrive" size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>
          磁盘 · {formatBytes(total.usedBytes)} / {formatBytes(total.totalBytes)}
        </Text>
        <Text
          style={{ color: theme.colors.foreground, fontSize: FONT_SIZE, fontVariant: ["tabular-nums"] }}
        >
          {formatPercent(total.percent)}
        </Text>
      </View>
      {/* statfs on an APFS volume counts every volume sharing its container, so say so: Finder and
          other tools often show the data volume alone. */}
      {disks.some((disk) => disk.fsType === "apfs") ? (
        <Caption theme={theme} text="APFS 容器：包含共享容器的所有卷" />
      ) : null}
      {/* A single disk is the total itself: its meter, not a repeat of the same numbers. */}
      {disks.length === 1 ? <Meter theme={theme} percent={total.percent} height={METER_HEIGHT - 2} /> : null}
      {disks.length > 1 ? disks.map((disk) => {
        const percent = diskPercent(disk);
        return (
          <View key={disk.mount} style={{ gap: 3, paddingLeft: ICON_SIZE + ICON_GAP }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
              <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ flex: 1, color: theme.colors.foreground, fontSize: FONT_SIZE - 1 }}
              >
                {disk.mount}
              </Text>
              <Text
                style={{
                  color: theme.colors.foregroundMuted,
                  fontSize: FONT_SIZE - 1,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)} ·{" "}
                <Text style={{ color: percent >= 70 ? loadColor(theme, percent) : theme.colors.foreground }}>
                  {formatPercent(percent)}
                </Text>
              </Text>
            </View>
            <Meter theme={theme} percent={percent} height={METER_HEIGHT - 2} />
          </View>
        );
      }) : null}
    </View>
  );
}

function HostOverview({ theme }: { theme: PluginTheme }) {
  const { data } = useHostStats();
  const rootStyle = { gap: 14, minWidth: 0 };
  if (!data) {
    return (
      <View style={rootStyle}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>正在加载主机数据...</Text>
      </View>
    );
  }

  const { current, history, memory, network, disks } = data;

  return (
    <View style={rootStyle}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>主机概览</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE - 1 }}>最近 3 分钟</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE + 1 }}>{data.hostname}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE - 1 }}>
          运行 {formatUptime(data.uptimeSeconds)} · 负载{" "}
          {data.loadAverage.map((n) => n.toFixed(2)).join(" ")}
        </Text>
      </View>
      <PreviewRow
        theme={theme}
        icon="Cpu"
        label={`CPU · ${data.cpuCount} 核`}
        value={formatPercent(current.cpuPercent)}
        color={loadColor(theme, current.cpuPercent)}
        values={history.map((s) => s.cpuPercent)}
      />
      <PreviewRow
        theme={theme}
        icon="MemoryStick"
        label={`RAM · ${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`}
        value={formatPercent(memoryPercent(memory))}
        color={severityColor(theme, memorySeverity(memory))}
        values={history.map((s) => s.memoryPercent)}
        detail={memoryDetail(memory)}
      />
      {data.gpu.devices.length ? data.gpu.devices.map((gpu) => {
        const gpuValues = gpuHistory(history, gpu.index);
        return (
        <View key={gpu.index} style={{ gap: 5, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: FONT_SIZE }}>GPU {gpu.index} · {gpu.name}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>GPU利用率</Text>
            <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE }}>{gpu.utilizationPercent === null ? "--" : formatPercent(gpu.utilizationPercent)}</Text>
          </View>
          <Sparkline values={gpuValues.utilizationPercent} color={gpu.utilizationPercent === null ? theme.colors.foregroundMuted : loadColor(theme, gpu.utilizationPercent)} height={18} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>GPU显存</Text>
            <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE }}>{gpu.memoryUsedBytes === null ? "--" : formatBytes(gpu.memoryUsedBytes)} / {gpu.memoryTotalBytes === null ? "--" : formatBytes(gpu.memoryTotalBytes)}</Text>
          </View>
          <Sparkline values={gpuValues.memoryPercent} color={theme.colors.foregroundMuted} height={18} />
        </View>
      ); }) : <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>GPU：-- · {data.gpu.reason ?? "不可用"}</Text>}
      {network ? (
        <>
          <PreviewRow
            theme={theme}
            icon="ArrowDown"
            label="下载"
            value={formatRate(current.rxBytesPerSec)}
            color={theme.colors.accent}
            values={scaleToPeak(history, (s) => s.rxBytesPerSec)}
          />
          <PreviewRow
            theme={theme}
            icon="ArrowUp"
            label="上传"
            value={formatRate(current.txBytesPerSec)}
            color={theme.colors.accent}
            values={scaleToPeak(history, (s) => s.txBytesPerSec)}
          />
        </>
      ) : null}
      {disks.length > 0 ? <DiskSection theme={theme} disks={disks} /> : null}
    </View>
  );
}

export function HostMonitorScreen({ theme, host, params }: PluginScreenProps) {
  const [width, setWidth] = useState<number | null>(null);
  const compact = width === null || width < 1000;
  const [tab, setTab] = useState<"overview" | "process">(params.tab === "process" ? "process" : "overview");
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flex: 1, minWidth: 0, minHeight: 0, alignSelf: "stretch", backgroundColor: theme.colors.surface1 }}>
    <ScrollView style={{ flex: 1, minHeight: 0, width: "100%" }}>
      {compact ? <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 16, gap: 20 }}>
        {(["overview", "process"] as const).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} aria-selected={tab === item} onPress={() => setTab(item)} style={{ minHeight: 44, justifyContent: "center", borderBottomWidth: 2, borderColor: tab === item ? theme.colors.accent : theme.colors.surface1 }}>
          <Text style={{ color: tab === item ? theme.colors.accent : theme.colors.foregroundMuted }}>{item === "overview" ? "主机概览" : "进程"}</Text>
        </Pressable>)}
      </View> : null}
      <View style={{ flexDirection: compact ? "column" : "row", minWidth: 0 }}>
        {!compact || tab === "overview" ? <View style={{ width: compact ? "100%" : 300, padding: 20, borderRightWidth: compact ? 0 : 1, borderColor: theme.colors.border }}><HostOverview theme={theme} /></View> : null}
        {!compact || tab === "process" ? <View style={{ flex: 1, minWidth: 0, padding: 20 }}><ProcessPanel theme={theme} compact={compact} hostId={host.id} /></View> : null}
      </View>
    </ScrollView>
    </View>
  );
}
