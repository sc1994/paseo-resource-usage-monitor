import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { processStatsRpc, type ProcessStats } from "../shared/processes";
import { orderProcesses, type SortDirection, type SortKey } from "./process-order";

export const processKeys: SortKey[] = ["cpu", "memory", "gpu", "network"];
type Sort = { key: SortKey; direction: SortDirection };

export function useProcessState(hostId: string, enabled = true, frozen: ProcessStats | null = null) {
  const getProcesses = useRpc(processStatsRpc);
  const client = useQueryClient();
  const sortKey = ["host-process-sort", hostId];
  const { data: sort } = useQuery<Sort>({
    queryKey: sortKey, queryFn: () => ({ key: "cpu", direction: "desc" }),
    enabled: false, initialData: { key: "cpu", direction: "desc" }, staleTime: Infinity, gcTime: Infinity,
  });
  const query = useQuery({
    queryKey: ["host-processes", hostId], queryFn: () => getProcesses({}),
    enabled, refetchInterval: enabled ? 2000 : false,
  });
  const data = frozen ?? query.data;
  const labels: Record<SortKey, string> = { cpu: "CPU", memory: "内存", gpu: data?.capabilities.gpu.mode === "memory" ? "GPU显存" : data?.capabilities.gpu.mode === "utilization" ? "GPU利用率" : "GPU", network: "网络" };
  const disabled = (key: SortKey) => key === "cpu" ? !data?.capabilities.cpu.available : key === "memory" ? !data?.processes.some((process) => process.memoryBytes !== null) : key === "gpu" ? !data || data.capabilities.gpu.mode === "unavailable" : !data?.capabilities.network.available;
  const activeSort = disabled(sort.key) ? processKeys.find((key) => !disabled(key)) ?? "cpu" : sort.key;
  const activeDirection = activeSort === sort.key ? sort.direction : "desc";
  const rows = data ? orderProcesses(data.processes, activeSort, activeDirection, data.capabilities.gpu.mode) : [];
  const changeSort = (key: SortKey) => {
    if (!enabled || disabled(key)) return;
    client.setQueryData<Sort>(sortKey, { key, direction: activeSort === key && activeDirection === "desc" ? "asc" : "desc" });
  };
  return { query, data, labels, disabled, activeSort, activeDirection, rows, changeSort };
}
