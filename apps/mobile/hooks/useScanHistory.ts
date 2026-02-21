import { useState, useCallback, useEffect } from "react";
import { getScanHistory, clearScanHistory, type ScanHistoryItem } from "@/lib/storage";

interface UseScanHistoryReturn {
  history: ScanHistoryItem[];
  refresh: () => void;
  clear: () => void;
}

export function useScanHistory(): UseScanHistoryReturn {
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);

  const refresh = useCallback(() => {
    setHistory(getScanHistory());
  }, []);

  const clear = useCallback(() => {
    clearScanHistory();
    setHistory([]);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { history, refresh, clear };
}
