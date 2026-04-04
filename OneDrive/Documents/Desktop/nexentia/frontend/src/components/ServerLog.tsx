import { useEffect, useRef } from 'react';
import { useProtection } from '../context/ProtectionContext';

export default function ServerLog() {
  const { serverLog, clearLog } = useProtection();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [serverLog]);

  const rowColor = (entry: { status: number; badge: 'BLOCKED' | 'PASSED' }) => {
    if (entry.badge === 'BLOCKED') return 'bg-orange-950/40 border-l-2 border-orange-500';
    if (entry.status >= 200 && entry.status < 300) return 'bg-green-950/20 border-l-2 border-green-700';
    return 'bg-red-950/30 border-l-2 border-red-700';
  };

  const statusColor = (status: number) => {
    if (status === 429 || status === 400) return 'text-orange-400';
    if (status >= 200 && status < 300) return 'text-green-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
          Live Server Log
        </h3>
        <button
          onClick={clearLog}
          className="text-xs text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded transition-colors"
        >
          Clear Log
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto flex flex-col-reverse gap-0.5 font-mono text-xs">
        {serverLog.length === 0 ? (
          <div className="text-gray-600 text-center py-8">No requests yet — launch an attack to see logs</div>
        ) : (
          [...serverLog].reverse().map((entry) => (
            <div
              key={entry.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded ${rowColor(entry)}`}
            >
              <span className="text-gray-600 shrink-0">{entry.timestamp}</span>
              <span className="text-blue-400 shrink-0 w-10">{entry.method}</span>
              <span className="text-gray-300 flex-1 truncate">{entry.path}</span>
              <span className={`shrink-0 font-bold ${statusColor(entry.status)}`}>{entry.status}</span>
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-bold ${
                  entry.badge === 'BLOCKED'
                    ? 'bg-orange-900/60 text-orange-300'
                    : 'bg-green-900/60 text-green-300'
                }`}
              >
                {entry.badge}
              </span>
              <span className="text-gray-600 shrink-0">{entry.latency}ms</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
