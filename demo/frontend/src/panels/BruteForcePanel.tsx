import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProtection } from '../context/ProtectionContext';
import { apiFetch } from '../lib/api';

const PASSWORDS = [
  'password', '12345678', 'admin', 'letmein', 'qwerty',
  'abc123', 'monkey', 'master', 'dragon', 'pass123',
  'welcome', 'login', 'admin2024', 'password1', 'admin123',
  'root', 'toor', 'test', 'guest', 'user',
];

interface AttemptLog {
  attempt: number;
  password: string;
  status: 'pending' | 'failed' | 'blocked' | 'success';
}

export default function BruteForcePanel() {
  const { protectionMode, addLogEntry } = useProtection();
  const [attacking, setAttacking] = useState(false);
  const [attempts, setAttempts] = useState<AttemptLog[]>([]);
  const [result, setResult] = useState<'cracked' | 'blocked' | null>(null);
  const [crackedInfo, setCrackedInfo] = useState<{ password: string; dbQuery?: string; role?: string; email?: string }>({ password: '' });
  const stopRef = useRef(false);

  const launchAttack = async () => {
    if (attacking) return;
    setAttacking(true);
    stopRef.current = false;
    setAttempts([]);
    setResult(null);

    for (let i = 0; i < PASSWORDS.length; i++) {
      if (stopRef.current) break;

      const password = PASSWORDS[i];
      const attemptNum = i + 1;

      setAttempts((prev) => [
        ...prev,
        { attempt: attemptNum, password, status: 'pending' },
      ]);

      const { data, status, latency } = await apiFetch(
        '/api/vulnerable/brute',
        {
          method: 'POST',
          body: JSON.stringify({ username: 'yessha', password, attemptNumber: attemptNum }),
        },
        protectionMode
      );

      const res = data as { success?: boolean; blocked?: boolean; crackedPassword?: string; role?: string; email?: string; dbQuery?: string };
      let attemptStatus: AttemptLog['status'] = 'failed';

      if (status === 429 || res.blocked) {
        attemptStatus = 'blocked';
        addLogEntry({
          timestamp: new Date().toLocaleTimeString(),
          method: 'POST',
          path: '/api/vulnerable/brute',
          status: 429,
          badge: 'BLOCKED',
          latency,
        });
        setAttempts((prev) =>
          prev.map((a) => (a.attempt === attemptNum ? { ...a, status: 'blocked' } : a))
        );
        setResult('blocked');
        setAttacking(false);
        return;
      } else if (res.success) {
        attemptStatus = 'success';
        setCrackedInfo({ password: res.crackedPassword || password, dbQuery: res.dbQuery, role: res.role, email: res.email });
        addLogEntry({
          timestamp: new Date().toLocaleTimeString(),
          method: 'POST',
          path: '/api/vulnerable/brute',
          status: 200,
          badge: 'PASSED',
          latency,
        });
        setAttempts((prev) =>
          prev.map((a) => (a.attempt === attemptNum ? { ...a, status: 'success' } : a))
        );
        setResult('cracked');
        setAttacking(false);
        return;
      } else {
        addLogEntry({
          timestamp: new Date().toLocaleTimeString(),
          method: 'POST',
          path: '/api/vulnerable/brute',
          status,
          badge: 'PASSED',
          latency,
        });
      }

      setAttempts((prev) =>
        prev.map((a) => (a.attempt === attemptNum ? { ...a, status: attemptStatus } : a))
      );

      await new Promise((r) => setTimeout(r, 300));
    }

    setAttacking(false);
  };

  const reset = () => {
    stopRef.current = true;
    setAttacking(false);
    setAttempts([]);
    setResult(null);
    setCrackedInfo({ password: '' });
  };

  const glowClass = protectionMode
    ? 'shadow-[0_0_20px_rgba(34,197,94,0.3)] border-l-4 border-green-500'
    : 'shadow-[0_0_20px_rgba(239,68,68,0.3)] border-l-4 border-red-500';

  const statusColor = (s: AttemptLog['status']) => {
    if (s === 'success') return 'text-green-400 bg-green-900/40';
    if (s === 'blocked') return 'text-orange-400 bg-orange-900/40';
    if (s === 'failed') return 'text-gray-500 bg-gray-800/40';
    return 'text-yellow-400 bg-yellow-900/20';
  };

  return (
    <div className={`bg-gray-900 rounded-xl p-6 ${glowClass} flex flex-col gap-4`}>
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-orange-400">🔓</span> Brute Force Attack
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Bot tries thousands of password combinations until it finds the correct one.
        </p>
      </div>

      {/* Mock Login */}
      <div className="flex flex-col gap-2">
        <input
          readOnly
          value="admin"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-400 text-sm font-mono"
        />
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-500 italic">
          {attacking ? `Trying: ${attempts[attempts.length - 1]?.password ?? '...'}` : '••••••••'}
        </div>
      </div>

      {/* Attempt Log */}
      {attempts.length > 0 && (
        <div className="bg-gray-950 rounded-lg p-3 max-h-40 overflow-y-auto flex flex-col gap-1">
          {attempts.map((a) => (
            <div
              key={a.attempt}
              className={`flex items-center gap-2 text-xs font-mono px-2 py-1 rounded ${statusColor(a.status)}`}
            >
              <span className="text-gray-500 w-6">#{a.attempt}</span>
              <span className="flex-1">{a.password}</span>
              <span className="uppercase text-xs">
                {a.status === 'pending' ? '⏳' : a.status === 'success' ? '✓' : a.status === 'blocked' ? '🚫' : '✗'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      <AnimatePresence>
        {result === 'cracked' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: [1, 1.05, 1] }}
            exit={{ opacity: 0 }}
            className="bg-red-900/80 border border-red-500 rounded-lg p-4 flex flex-col gap-3"
          >
            <div className="text-xl font-bold text-red-400 text-center">🔓 PASSWORD CRACKED via NeonDB</div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-2xl font-mono font-bold text-yellow-300 text-center"
            >
              {crackedInfo.password}
            </motion.div>
            <div className="text-sm text-red-300 text-center">Found after {attempts.length} attempts</div>
            {crackedInfo.dbQuery && (
              <div className="bg-black/50 rounded p-3 font-mono text-xs">
                <div className="text-yellow-400 mb-1">Executed DB Query:</div>
                <div className="text-orange-300 break-all">{crackedInfo.dbQuery}</div>
              </div>
            )}
            {(crackedInfo.role || crackedInfo.email) && (
              <div className="bg-black/50 rounded p-3 font-mono text-xs">
                <div className="text-yellow-400 mb-1">Compromised Account:</div>
                {crackedInfo.role && <div className="text-red-300">Role: <span className="text-white">{crackedInfo.role}</span></div>}
                {crackedInfo.email && <div className="text-red-300">Email: <span className="text-white">{crackedInfo.email}</span></div>}
              </div>
            )}
          </motion.div>
        )}
        {result === 'blocked' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="bg-green-900/80 border border-green-500 rounded-lg p-4 text-center"
          >
            <div className="text-xl font-bold text-green-400">🛡️ ATTACK BLOCKED</div>
            <div className="text-sm text-green-300 mt-1">
              Blocked after {attempts.filter((a) => a.status !== 'blocked').length} attempts — rate limit enforced
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={launchAttack}
          disabled={attacking}
          className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-colors"
        >
          {attacking ? '🔓 Attacking...' : '🔓 Launch Brute Force'}
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
