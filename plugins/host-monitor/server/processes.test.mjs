import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpuPercent, parseGpu, parseProcStat, parseRssBytes, parseSockets, redactCommand, socketRates, startProcessSampler } from "./processes.ts";

test("proc stat 正确解析带空格和右括号的名称及身份", () => {
  const fields = ["5", ...Array(9).fill("0"), "12", "3", ...Array(6).fill("0"), "12345"];
  assert.deepEqual(parseProcStat(`42 (foo ) bar) S ${fields.join(" ")}`), { pid: 42, name: "foo ) bar", ppid: 5, ticks: 15, startTime: "12345" });
  assert.equal(parseProcStat("invalid"), null);
});

test("status RSS 以 KiB 转换为字节，缺失或无效时为空", () => {
  assert.equal(parseRssBytes("Uid:\t1000\nVmRSS:\t123 kB\n"), 123 * 1024);
  assert.equal(parseRssBytes("VmRSS:\t0 kB\n"), 0);
  for (const status of ["Uid:\t1000\n", "VmRSS: -1 kB\n", "VmRSS: 1.5 kB\n", "VmRSS: 1 MB\n", "VmRSS: 8796093022208 kB\n"]) {
    assert.equal(parseRssBytes(status), null);
  }
});

test("CPU 差值需要同一身份和有效基线", () => {
  const current = { ticks: 30, startTime: "7" };
  assert.equal(cpuPercent(undefined, current, 100, 4), null);
  assert.equal(cpuPercent({ ticks: 20, startTime: "8" }, current, 100, 4), null);
  assert.equal(cpuPercent({ ticks: 40, startTime: "7" }, current, 100, 4), null);
  assert.equal(cpuPercent({ ticks: 20, startTime: "7" }, current, 0, 4), null);
  assert.equal(cpuPercent({ ticks: 20, startTime: "7" }, current, 100, 4), 40);
});

test("GPU 缺少 SM 数值时使用显存，不伪造利用率", () => {
  const gpu = parseGpu("42, python, 100\n42, python, 50\n", "0 42 C - - - - python\n");
  assert.equal(gpu.mode, "memory");
  assert.equal(gpu.memory.get(42), 150 * 1024 * 1024);
  assert.equal(gpu.utilization.get(42), undefined);
});

test("TCP 按 socket 差分，忽略新连接、关闭连接和多所有者", () => {
  const line = (ino, pid, rx, tx) => `ESTAB 0 0 a b users:((\"x\",pid=${pid},fd=1)) ino:${ino} sk:${ino}\n  bytes_received:${rx} bytes_sent:${tx}\n`;
  const previous = parseSockets(line("1", 42, 100, 200) + line("2", 42, 500, 600));
  const current = parseSockets(line("1", 42, 140, 260) + line("3", 42, 5000, 6000) + `ESTAB 0 0 a b users:((\"x\",pid=42,fd=1),(\"y\",pid=43,fd=2)) ino:4 sk:4\n  bytes_received:200 bytes_sent:300\n`);
  assert.deepEqual(socketRates(previous, current, 2).get(42), { rx: 20, tx: 30 });
  assert.equal(current.has("4:4"), false);
});

test("命令隐藏常见参数和 URL 凭据", () => {
  const value = redactCommand(["curl", "--password", "abc", "--api-key=xyz", "https://user:pass@example.com/?token=123"]);
  for (const secret of ["abc", "xyz", "user:pass", "123"]) assert.equal(value.includes(secret), false);
  const url = redactCommand(["https://alice:secret@example.com/?page=1"]);
  assert.equal(url.includes("alice:secret"), false);
  assert.equal(url.includes("page=1"), true);
});

test("只允许结束已采样且身份匹配的自建进程", { skip: process.platform !== "linux", timeout: 10000 }, async (t) => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const sampler = startProcessSampler();
  try {
    const sample = await sampler.read();
    if (!sample.capabilities.release.available) {
      t.skip(sample.capabilities.release.reason ?? "pidfd 不可用");
      return;
    }
    const target = sample.processes.find((entry) => entry.pid === child.pid);
    assert.ok(target);
    const self = sample.processes.find((entry) => entry.pid === process.pid);
    assert.ok(self);
    assert.equal((await sampler.terminate(process.pid, self.startTime)).status, "protected");
    assert.equal((await sampler.terminate(child.pid, `${target.startTime}0`)).status, "identity_changed");
    assert.equal(readFileSync(`/proc/${child.pid}/stat`, "utf8").length > 0, true);
    assert.equal((await sampler.terminate(child.pid, target.startTime)).status, "terminated");
    const after = await sampler.read();
    assert.equal(after.processes.some((entry) => entry.pid === child.pid && entry.startTime === target.startTime), false);
  } finally {
    sampler.stop();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
});
