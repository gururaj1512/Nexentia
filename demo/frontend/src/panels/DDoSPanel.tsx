import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProtection } from '../context/ProtectionContext';
import { apiFetch } from '../lib/api';

export default function DDoSPanel() {
  const { protectionMode, addLogEntry } = useProtection();
  const [attacking, setAttacking] = useState(false);
  const [serverLoad, setServerLoad] = useState(0);
  const [sent, setSent] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [passed, setPassed] = useState(0);
  const [result, setResult] = useState<'crashed' | 'blocked' | null>(null);
  const stopRef = useRef(false);

  const launchAttack = async () => {
    if (attacking) return;
    setAttacking(true);
    stopRef.current = false;
    setServerLoad(0);
    setSent(0);
    setBlocked(0);
    setPassed(0);
    setResult(null);

    const totalMs = 5000;
    const batchInterval = 100;
    const batches = totalMs / batchInterval;
    let totalSent = 0;
    let totalBlocked = 0;
    let totalPassed = 0;

    for (let i = 0; i < batches; i++) {
      if (stopRef.current) break;

      const batchPromises = Array.from({ length: 50 }, async () => {
        try {
          const { status, latency } = await apiFetch('/api/vulnerable/data', {}, protectionMode);
          const isBlocked = status === 429;
          addLogEntry({
            timestamp: new Date().toLocaleTimeString(),
            method: 'GET',
            path: '/api/vulnerable/data',
            status,
            badge: isBlocked ? 'BLOCKED' : 'PASSED',
            latency,
          });
          return isBlocked;
        } catch {
          return false;
        }
      });

      const results = await Promise.all(batchPromises);
      const batchBlocked = results.filter(Boolean).length;
      const batchPassed = results.length - batchBlocked;

      totalSent += results.length;
      totalBlocked += batchBlocked;
      totalPassed += batchPassed;

      setSent(totalSent);
      setBlocked(totalBlocked);
      setPassed(totalPassed);

      const loadPct = protectionMode
        ? Math.min((i / batches) * 30, 30)
        : Math.min((i / batches) * 100, 100);
      setServerLoad(Math.round(loadPct));

      await new Promise((r) => setTimeout(r, batchInterval));
    }

    setResult(protectionMode ? 'blocked' : 'crashed');
    setAttacking(false);
  };

  const reset = () => {
    stopRef.current = true;
    setAttacking(false);
    setServerLoad(0);
    setSent(0);
    setBlocked(0);
    setPassed(0);
    setResult(null);
  };

  const glowClass = protectionMode
    ? 'shadow-[0_0_20px_rgba(34,197,94,0.3)] border-l-4 border-green-500'
    : 'shadow-[0_0_20px_rgba(239,68,68,0.3)] border-l-4 border-red-500';

  return (
    <div className={`bg-gray-900 rounded-xl p-6 ${glowClass} flex flex-col gap-4`}>
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-red-400">⚡</span> DDoS Attack — Request Flood
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          A botnet sends thousands of requests per second to overwhelm the server.
        </p>
      </div>

      {/* Server Load Bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Server Load</span>
          <span>{serverLoad}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
          <motion.div
            className={`h-4 rounded-full transition-colors ${serverLoad >= 80 ? 'bg-red-500' : serverLoad >= 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
            animate={{ width: `${serverLoad}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Sent', value: sent, color: 'text-blue-400' },
          { label: 'Blocked', value: blocked, color: 'text-orange-400' },
          { label: 'Passed', value: passed, color: 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-800 rounded-lg p-3">
            <div className={`text-2xl font-mono font-bold ${color}`}>{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Result Banner */}
      <AnimatePresence>
        {result === 'crashed' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [1, 0.3, 1, 0.3, 1], scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, repeat: 3 }}
            className="bg-red-900/80 border border-red-500 rounded-lg p-4 text-center"
          >
            <div className="text-2xl font-bold text-red-400">💀 SERVER CRASHED</div>
            <div className="text-sm text-red-300 mt-1">All {sent} requests flooded through unblocked</div>
          </motion.div>
        )}
        {result === 'blocked' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="bg-green-900/80 border border-green-500 rounded-lg p-4 text-center"
          >
            <div className="text-2xl font-bold text-green-400">🛡️ ATTACK BLOCKED</div>
            <div className="text-sm text-green-300 mt-1">Rate limiter blocked {blocked} of {sent} requests</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={launchAttack}
          disabled={attacking}
          className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
        >
          {attacking ? '⚡ Flooding...' : '⚡ Launch DDoS Attack'}
        </button>
        <button
          onClick={reset}
          className="bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded-lg transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
