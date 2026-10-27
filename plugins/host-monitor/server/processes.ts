import { execFile, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import os from "node:os";
import type { ProcessStats, ProcessUsage, TerminateResult } from "../shared/processes";

const INTERVAL = 2000;
const TIMEOUT = 1500;
const NETWORK_REASON = "仅统计可唯一归属的可见 TCP 持续连接（含回环），发送量使用 bytes_sent；不含 UDP 和短连接。";

type Proc = { pid: number; ppid: number; startTime: string; ticks: number; uid: number; name: string; command: string };
type Socket = { pid: number; rx: number; tx: number };
type Gpu = { memory: Map<number, number>; utilization: Map<number, number>; mode: ProcessStats["capabilities"]["gpu"]["mode"]; reason: string | null };

export function parseProcStat(text: string): { pid: number; ppid: number; name: string; ticks: number; startTime: string } | null {
  const match = /^(\d+) \(([\s\S]*)\) ([A-Za-z]) (.*)$/.exec(text.trim());
  if (!match) return null;
  const fields = match[4]!.split(/\s+/);
  const ppid = Number(fields[0]);
  const ticks = Number(fields[10]) + Number(fields[11]);
  const startTime = fields[18];
  if (!Number.isSafeInteger(ppid) || !Number.isFinite(ticks) || !startTime || !/^\d+$/.test(startTime)) return null;
  return { pid: Number(match[1]), name: match[2]!, ppid, ticks, startTime };
}

export function cpuPercent(previous: { ticks: number; startTime: string } | undefined, current: { ticks: number; startTime: string }, totalDelta: number, cores: number): number | null {
  if (!previous || previous.startTime !== current.startTime || totalDelta <= 0 || current.ticks < previous.ticks || cores <= 0) return null;
  return (current.ticks - previous.ticks) / totalDelta * cores * 100;
}

export function redactCommand(args: string[]): string {
  const secret = /(?:password|passwd|token|api[-_]?key|secret|credential|authorization)/i;
  let hideNext = false;
  return args.map((arg) => {
    if (hideNext) { hideNext = false; return "[已隐藏]"; }
    const assignment = /^([A-Za-z0-9_-]+)=(.*)$/.exec(arg);
    if (assignment && secret.test(assignment[1]!)) return `${assignment[1]}=[已隐藏]`;
    if (arg.startsWith("-") && secret.test(arg)) { hideNext = true; return arg; }
    return arg.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[已隐藏]@")
      .replace(/([?&](?:password|passwd|token|api[-_]?key|secret|credential|authorization)=)[^&#\s]*/gi, "$1[已隐藏]");
  }).join(" ").slice(0, 2048);
}

function readProc(pid: number): Proc | null {
  try {
    const stat = parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
    const uid = /^Uid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    if (!stat || !uid) return null;
    let args: string[] = [];
    try {
      const fd = openSync(`/proc/${pid}/cmdline`, "r");
      try {
        const buffer = Buffer.alloc(8192);
        args = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, null)).toString().split("\0").filter(Boolean);
      } finally { closeSync(fd); }
    } catch { /* Process can exit during sampling. */ }
    return { ...stat, uid: Number(uid[1]), command: args.length ? redactCommand(args) : stat.name };
  } catch { return null; }
}

function totalCpu(): number {
  const line = readFileSync("/proc/stat", "utf8").split("\n", 1)[0];
  if (!line || !/^cpu\s/.test(line)) throw new Error("无法读取 CPU 总计数");
  const values = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) throw new Error("CPU 总计数无效");
  return values.reduce((sum, value) => sum + value, 0);
}

function protectedPids(): Set<number> | null {
  const protectedSet = new Set<number>([1]);
  let pid = process.pid;
  while (pid > 1 && !protectedSet.has(pid)) {
    protectedSet.add(pid);
    const proc = readProc(pid);
    if (!proc || proc.ppid <= 0) return null;
    pid = proc.ppid;
  }
  return protectedSet;
}

export function parseGpu(memoryOutput: string, pmonOutput: string | null): Gpu {
  const memory = new Map<number, number>();
  for (const line of memoryOutput.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split(",").map((field) => field.trim());
    const pid = Number(fields[0]);
    const mb = Number(fields[fields.length - 1]);
    if (Number.isSafeInteger(pid) && pid > 0 && Number.isFinite(mb) && mb >= 0 && fields[fields.length - 1] !== "") memory.set(pid, (memory.get(pid) ?? 0) + mb * 1024 * 1024);
  }
  const utilization = new Map<number, number>();
  for (const line of (pmonOutput ?? "").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const fields = line.trim().split(/\s+/);
    const pid = Number(fields[1]);
    const sm = fields[3];
    if (Number.isSafeInteger(pid) && pid > 0 && sm && /^\d+(?:\.\d+)?$/.test(sm)) utilization.set(pid, (utilization.get(pid) ?? 0) + Number(sm));
  }
  return { memory, utilization, mode: utilization.size ? "utilization" : "memory", reason: utilization.size ? "多设备的进程 SM 利用率相加。" : "SM 利用率不可用，显示多设备显存之和。" };
}

export function parseSockets(output: string): Map<string, Socket> {
  const sockets = new Map<string, Socket>();
  // shortcut: TCP 快照不包含 UDP 及两次采样间结束的短连接，需要这些流量时改用有权限的 eBPF。
  for (const block of output.split(/\n(?=\S)/)) {
    const owners = new Set([...block.matchAll(/\bpid=(\d+)/g)].map((match) => Number(match[1])));
    const ino = /\bino:(\d+)/.exec(block)?.[1];
    const sk = /\bsk:([\da-f]+)/i.exec(block)?.[1];
    const rx = /\bbytes_received:(\d+)/.exec(block)?.[1];
    const tx = /\bbytes_sent:(\d+)/.exec(block)?.[1];
    if (owners.size !== 1 || !ino || !sk || (!rx && !tx)) continue;
    sockets.set(`${ino}:${sk}`, { pid: [...owners][0]!, rx: Number(rx ?? 0), tx: Number(tx ?? 0) });
  }
  return sockets;
}

export function socketRates(previous: Map<string, Socket>, current: Map<string, Socket>, seconds: number): Map<number, { rx: number; tx: number }> {
  const rates = new Map<number, { rx: number; tx: number }>();
  if (seconds <= 0) return rates;
  for (const [key, socket] of current) {
    const old = previous.get(key);
    if (!old || old.pid !== socket.pid || socket.rx < old.rx || socket.tx < old.tx) continue;
    const value = rates.get(socket.pid) ?? { rx: 0, tx: 0 };
    value.rx += (socket.rx - old.rx) / seconds;
    value.tx += (socket.tx - old.tx) / seconds;
    rates.set(socket.pid, value);
  }
  return rates;
}

const PYTHON = String.raw`
import json, os, select, signal, sys

def emit(status, message):
    print(json.dumps({'status': status, 'message': message}, ensure_ascii=False))

if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
    emit('unavailable', '当前 Python 不支持 pidfd'); sys.exit(0)
if len(sys.argv) == 1:
    try:
        fd = os.pidfd_open(os.getpid(), 0); os.close(fd)
        emit('terminated', 'pidfd 可用')
    except OSError:
        emit('unavailable', '当前系统不支持 pidfd')
    sys.exit(0)
pid = int(sys.argv[1]); expected = sys.argv[2]; uid = int(sys.argv[3])
try:
    fd = os.pidfd_open(pid, 0)
    with open('/proc/%d/stat' % pid) as f: stat = f.read()
    start = stat[stat.rfind(')') + 2:].split()[19]
    with open('/proc/%d/status' % pid) as f: status = f.read()
    actual_uid = int(next(line for line in status.splitlines() if line.startswith('Uid:')).split()[1])
    if start != expected:
        emit('identity_changed', '进程身份已变化')
    elif actual_uid != uid:
        emit('permission_denied', '只能结束当前用户的进程')
    else:
        signal.pidfd_send_signal(fd, signal.SIGTERM)
        poller = select.poll(); poller.register(fd, select.POLLIN)
        if poller.poll(1000): emit('terminated', '进程已结束')
        else: emit('still_running', '已发送 SIGTERM，进程仍在运行')
    os.close(fd)
except ProcessLookupError:
    emit('already_exited', '进程已退出')
except FileNotFoundError:
    emit('already_exited', '进程已退出')
except PermissionError:
    emit('permission_denied', '没有权限结束该进程')
except (AttributeError, NotImplementedError):
    emit('unavailable', '当前系统不支持 pidfd')
except OSError as e:
    if e.errno in (38, 22): emit('unavailable', '当前系统不支持 pidfd')
    else: emit('error', '结束进程失败: ' + str(e))
`;

export function startProcessSampler(): { read(): Promise<ProcessStats>; terminate(pid: number, startTime: string): Promise<TerminateResult>; stop(): void } {
  const children = new Set<ChildProcess>();
  let stopped = false;
  const run = (command: string, args: string[], timeout = TIMEOUT): Promise<string> => new Promise((resolve, reject) => {
    if (stopped) { reject(new Error("采样已停止")); return; }
    const child = execFile(command, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      children.delete(child);
      if (error) reject(error); else resolve(stdout);
    });
    children.add(child);
  });
  const unavailable = (reason: string): ProcessStats => ({ sampledAt: Date.now(), intervalMs: INTERVAL, processes: [], capabilities: { cpu: { available: false, reason }, gpu: { mode: "unavailable", reason }, network: { available: false, reason }, release: { available: false, reason } } });
  let cache = unavailable("正在初始化进程采样");
  let previousProcs = new Map<number, Proc>();
  const exited = new Set<string>();
  let previousTotal: number | null = null;
  let previousSockets = new Map<string, Socket>();
  let previousNetAt: number | null = null;
  let releaseAvailable = false;
  let releaseReason: string | null = "正在检查 pidfd 支持";
  const active = new Set<string>();
  const probe = run("python3", ["-c", PYTHON]).then((out) => {
    const result: TerminateResult = JSON.parse(out);
    releaseAvailable = result.status === "terminated";
    releaseReason = releaseAvailable ? null : result.message;
  }).catch(() => { releaseReason = "Python3 或 pidfd 不可用"; });
  let inFlight: Promise<void> | null = null;
  const sample = async () => {
    await probe;
    if (stopped) return;
    if (process.platform !== "linux") { cache = unavailable("仅支持 Linux 进程采样"); return; }
    let processes: Proc[];
    let total: number;
    try {
      total = totalCpu();
      processes = readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).map((entry) => readProc(Number(entry))).filter((proc): proc is Proc => proc !== null);
    } catch (error) { cache = unavailable(`进程采样失败：${error instanceof Error ? error.message : String(error)}`); return; }
    const [memoryOutput, pmonOutput, networkOutput] = await Promise.all([
      run("nvidia-smi", ["--query-compute-apps=pid,process_name,used_gpu_memory", "--format=csv,noheader,nounits"]).catch(() => null),
      run("nvidia-smi", ["pmon", "-c", "1", "-s", "u"]).catch(() => null),
      run("ss", ["-tinpeHO", "state", "established"]).then((output) => ({ output, at: performance.now() })).catch(() => null),
    ]);
    if (stopped) return;
    const observed = new Set(processes.map((proc) => `${proc.pid}:${proc.startTime}`));
    for (const key of exited) if (!observed.has(key)) exited.delete(key);
    processes = processes.filter((proc) => !exited.has(`${proc.pid}:${proc.startTime}`));
    const gpu: Gpu = memoryOutput === null ? { memory: new Map(), utilization: new Map(), mode: "unavailable", reason: "无法读取 NVIDIA 进程数据" } : parseGpu(memoryOutput, pmonOutput);
    const netAt = networkOutput?.at ?? null;
    const sockets = networkOutput === null ? new Map<string, Socket>() : parseSockets(networkOutput.output);
    const rates = netAt !== null && previousNetAt !== null ? socketRates(previousSockets, sockets, (netAt - previousNetAt) / 1000) : new Map<number, { rx: number; tx: number }>();
    const protectedSet = protectedPids();
    const currentUid = process.getuid?.();
    const user = os.userInfo();
    const cores = os.cpus().length;
    const result: ProcessUsage[] = processes.map((proc) => {
      const previous = previousProcs.get(proc.pid);
      const rate = previous?.startTime === proc.startTime ? rates.get(proc.pid) : undefined;
      const reason = !protectedSet ? "无法确认保护链" : protectedSet.has(proc.pid) ? "受保护的系统或服务进程" : currentUid === undefined || proc.uid !== currentUid ? "非当前用户进程" : !releaseAvailable ? releaseReason : null;
      return { pid: proc.pid, startTime: proc.startTime, name: proc.name, user: proc.uid === user.uid ? user.username : String(proc.uid), command: proc.command,
        cpuPercent: cpuPercent(previous, proc, previousTotal === null ? 0 : total - previousTotal, cores),
        gpuPercent: gpu.utilization.get(proc.pid) ?? null, gpuMemoryBytes: gpu.memory.get(proc.pid) ?? null,
        rxBytesPerSec: rate?.rx ?? null, txBytesPerSec: rate?.tx ?? null, canTerminate: reason === null, protectionReason: reason };
    });
    previousProcs = new Map(processes.map((proc) => [proc.pid, proc]));
    previousTotal = total;
    previousSockets = sockets;
    previousNetAt = networkOutput === null ? null : netAt;
    cache = { sampledAt: Date.now(), intervalMs: INTERVAL, processes: result, capabilities: { cpu: { available: true, reason: null }, gpu: { mode: gpu.mode, reason: gpu.reason }, network: { available: networkOutput !== null, reason: networkOutput === null ? "无法读取 TCP 连接数据" : NETWORK_REASON }, release: { available: releaseAvailable && protectedSet !== null, reason: protectedSet === null ? "无法确认保护链" : releaseReason } } };
  };
  const tick = () => {
    if (!inFlight && !stopped) inFlight = sample().catch((error: unknown) => { cache = unavailable(`进程采样失败：${error instanceof Error ? error.message : String(error)}`); }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const first = tick();
  const timer = setInterval(tick, INTERVAL);
  return {
    async read() { await first; return cache; },
    async terminate(pid, startTime) {
      if (!Number.isSafeInteger(pid) || pid <= 1 || !/^\d+$/.test(startTime)) return { status: "protected", message: "无效的进程身份" };
      const key = `${pid}:${startTime}`;
      if (active.has(key)) return { status: "still_running", message: "结束请求正在处理" };
      const sampled = previousProcs.get(pid);
      if (!sampled || sampled.startTime !== startTime) return { status: "identity_changed", message: "进程身份与采样不符" };
      const protectedSet = protectedPids();
      if (!protectedSet || protectedSet.has(pid)) return { status: "protected", message: "进程位于保护链或保护链不可确认" };
      const uid = process.getuid?.();
      if (uid === undefined || sampled.uid !== uid) return { status: "permission_denied", message: "只能结束当前用户的进程" };
      if (!releaseAvailable || stopped) return { status: "unavailable", message: releaseReason ?? "结束功能不可用" };
      active.add(key);
      try {
        const out = await run("python3", ["-c", PYTHON, String(pid), startTime, String(uid)], 2500);
        const result: TerminateResult = JSON.parse(out);
        if (result.status === "terminated" || result.status === "already_exited") {
          exited.add(key);
          cache = { ...cache, processes: cache.processes.filter((proc) => proc.pid !== pid || proc.startTime !== startTime) };
          if (previousProcs.get(pid)?.startTime === startTime) previousProcs.delete(pid);
        }
        return result;
      } catch { return { status: "unavailable", message: "pidfd 辅助进程不可用或超时" }; }
      finally { active.delete(key); }
    },
    stop() { stopped = true; clearInterval(timer); for (const child of children) child.kill(); },
  };
}
