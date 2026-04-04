import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProtection } from '../context/ProtectionContext';
import { apiFetch } from '../lib/api';

const PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users;--",
  "' UNION SELECT * FROM passwords--",
];

interface LoginResult {
  success?: boolean;
  blocked?: boolean;
  reason?: string;
  pattern_matched?: string;
  message?: string;
  data?: {
    userId: number;
    role: string;
    secret: string;
    sessionToken: string;
    allUsers: Array<{ id: number; username: string; email: string; role: string; passwordHash: string }>;
    dbQuery: string;
  };
}

export default function SQLPanel() {
  const { protectionMode, addLogEntry } = useProtection();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoginResult | null>(null);

  const submit = async () => {
    setLoading(true);
    setResult(null);
    const { data, status, latency } = await apiFetch(
      '/api/vulnerable/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
      protectionMode
    );
    const res = data as LoginResult;
    setResult(res);
    addLogEntry({
      timestamp: new Date().toLocaleTimeString(),
      method: 'POST',
      path: '/api/vulnerable/login',
      status,
      badge: res.blocked ? 'BLOCKED' : 'PASSED',
      latency,
    });
    setLoading(false);
  };

  const glowClass = protectionMode
    ? 'shadow-[0_0_20px_rgba(34,197,94,0.3)] border-l-4 border-green-500'
    : 'shadow-[0_0_20px_rgba(239,68,68,0.3)] border-l-4 border-red-500';

  return (
    <div className={`bg-gray-900 rounded-xl p-6 ${glowClass} flex flex-col gap-4`}>
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-yellow-400">💉</span> SQL Injection Attack
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Attacker injects malicious SQL into a login form to bypass authentication.
        </p>
      </div>

      {/* Quick Inject Buttons */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Quick Inject</span>
        <div className="flex flex-col gap-1">
          {PAYLOADS.map((p) => (
            <button
              key={p}
              onClick={() => setUsername(p)}
              className="text-left text-xs font-mono bg-red-950/50 hover:bg-red-900/50 border border-red-800/50 text-red-300 px-3 py-2 rounded transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Login Form */}
      <div className="flex flex-col gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-500"
        />
        <button
          onClick={submit}
          disabled={loading}
          className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg transition-colors"
        >
          {loading ? 'Submitting...' : 'Submit Login'}
        </button>
      </div>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {result.blocked ? (
              <div className="bg-green-900/80 border border-green-500 rounded-lg p-4">
                <div className="text-lg font-bold text-green-400">🛡️ ATTACK BLOCKED</div>
                <div className="text-sm text-green-300 mt-1">{result.reason}</div>
                {result.pattern_matched && (
                  <div className="text-xs text-gray-400 mt-1 font-mono">
                    Pattern: <span className="text-red-400">{result.pattern_matched}</span>
                  </div>
                )}
              </div>
            ) : result.success ? (
              <div className="bg-red-900/80 border border-red-500 rounded-lg p-4 flex flex-col gap-3">
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 0.5, repeat: 2 }}
                  className="text-xl font-bold text-red-400"
                >
                  ☠️ DATABASE BREACHED
                </motion.div>
                <div className="text-sm text-red-300">{result.message}</div>
                {result.data && (
                  <>
                    <div className="bg-black/50 rounded p-3 font-mono text-xs">
                      <div className="text-yellow-400 mb-1">Leaked API Key:</div>
                      <div className="text-red-300 break-all">{result.data.secret}</div>
                    </div>
                    <div className="bg-black/50 rounded p-3 font-mono text-xs">
                      <div className="text-yellow-400 mb-1">Executed Query:</div>
                      <div className="text-orange-300 break-all">{result.data.dbQuery}</div>
                    </div>
                    <div className="bg-black/50 rounded p-3 font-mono text-xs">
                      <div className="text-yellow-400 mb-2">Dumped User Table ({result.data.allUsers.length} records):</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-700">
                              <th className="text-left pr-3 pb-1">ID</th>
                              <th className="text-left pr-3 pb-1">Username</th>
                              <th className="text-left pr-3 pb-1">Email</th>
                              <th className="text-left pr-3 pb-1">Role</th>
                              <th className="text-left pb-1">Hash</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.data.allUsers.map((u) => (
                              <tr key={u.id} className="text-green-300 border-b border-gray-800/50">
                                <td className="pr-3 py-1">{u.id}</td>
                                <td className="pr-3">{u.username}</td>
                                <td className="pr-3">{u.email}</td>
                                <td className="pr-3">{u.role}</td>
                                <td className="text-red-400">{u.passwordHash}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-400">
                {result.message}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
