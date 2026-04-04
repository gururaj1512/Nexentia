import React, { createContext, useContext, useState, useCallback } from 'react';

export interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  badge: 'BLOCKED' | 'PASSED';
  latency: number;
}

interface ProtectionContextType {
  protectionMode: boolean;
  setProtectionMode: (v: boolean) => void;
  serverLog: LogEntry[];
  addLogEntry: (entry: Omit<LogEntry, 'id'>) => void;
  clearLog: () => void;
  globalRequestCount: number;
  blockedCount: number;
}

const ProtectionContext = createContext<ProtectionContextType | null>(null);

export function ProtectionProvider({ children }: { children: React.ReactNode }) {
  const [protectionMode, setProtectionMode] = useState(false);
  const [serverLog, setServerLog] = useState<LogEntry[]>([]);
  const [globalRequestCount, setGlobalRequestCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);

  const addLogEntry = useCallback((entry: Omit<LogEntry, 'id'>) => {
    const id = crypto.randomUUID();
    setServerLog((prev) => [{ id, ...entry }, ...prev].slice(0, 100));
    setGlobalRequestCount((c) => c + 1);
    if (entry.badge === 'BLOCKED') setBlockedCount((c) => c + 1);
  }, []);

  const clearLog = useCallback(() => setServerLog([]), []);

  return (
    <ProtectionContext.Provider
      value={{
        protectionMode,
        setProtectionMode,
        serverLog,
        addLogEntry,
        clearLog,
        globalRequestCount,
        blockedCount,
      }}
    >
      {children}
    </ProtectionContext.Provider>
  );
}

export function useProtection() {
  const ctx = useContext(ProtectionContext);
  if (!ctx) throw new Error('useProtection must be used within ProtectionProvider');
  return ctx;
}
