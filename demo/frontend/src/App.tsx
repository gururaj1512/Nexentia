import { useState } from 'react';
import { motion } from 'framer-motion';
import { ProtectionProvider, useProtection } from './context/ProtectionContext';
import DDoSPanel from './panels/DDoSPanel';
import SQLPanel from './panels/SQLPanel';
import XSSPanel from './panels/XSSPanel';
import BruteForcePanel from './panels/BruteForcePanel';
import ServerLog from './components/ServerLog';
import Toast from './components/Toast';

function Dashboard() {
  const { protectionMode, setProtectionMode, globalRequestCount, blockedCount } = useProtection();
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'warning'>('success');

  const handleToggle = () => {
    const next = !protectionMode;
    setProtectionMode(next);
    if (next) {
      setToastMsg('🛡️ Proxy Shield Activated');
      setToastType('success');
    } else {
      setToastMsg('⚠️ Protection Disabled — Attacks will succeed');
      setToastType('warning');
    }
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Toast show={showToast} message={toastMsg} type={toastType} />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="text-2xl">🔐</div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">CyberAttack Demo</h1>
              <p className="text-xs text-gray-500">Interactive Security Dashboard</p>
            </div>
          </div>

          {/* Big Toggle */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-bold ${!protectionMode ? 'text-red-400' : 'text-gray-600'}`}>
                UNPROTECTED
              </span>
              <button
                onClick={handleToggle}
                className={`relative w-20 h-10 rounded-full transition-colors duration-300 focus:outline-none ${
                  protectionMode ? 'bg-green-600' : 'bg-red-700'
                }`}
              >
                <motion.div
                  animate={{ x: protectionMode ? 44 : 4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="absolute top-1 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center"
                >
                  {protectionMode ? (
                    <span className="text-green-600 text-xs">🛡️</span>
                  ) : (
                    <span className="text-red-600 text-xs">⚠️</span>
                  )}
                </motion.div>
              </button>
              <span className={`text-sm font-bold ${protectionMode ? 'text-green-400' : 'text-gray-600'}`}>
                PROTECTED
              </span>
            </div>
            <span
              className={`text-xs px-3 py-0.5 rounded-full font-bold ${
                protectionMode ? 'bg-green-900/60 text-green-400' : 'bg-red-900/60 text-red-400'
              }`}
            >
              {protectionMode ? '🛡️ Reverse Proxy Active' : '🔓 Proxy Disabled'}
            </span>
          </div>

          {/* Global Counters */}
          <div className="flex gap-4 text-center">
            <div className="bg-gray-800 rounded-lg px-4 py-2">
              <div className="text-xl font-mono font-bold text-blue-400">{globalRequestCount}</div>
              <div className="text-xs text-gray-500">Total Requests</div>
            </div>
            <div className="bg-gray-800 rounded-lg px-4 py-2">
              <div className="text-xl font-mono font-bold text-orange-400">{blockedCount}</div>
              <div className="text-xs text-gray-500">Blocked</div>
            </div>
            <div className="bg-gray-800 rounded-lg px-4 py-2">
              <div className="text-xl font-mono font-bold text-green-400">{globalRequestCount - blockedCount}</div>
              <div className="text-xs text-gray-500">Passed</div>
            </div>
          </div>
        </div>
      </header>

      {/* Mode Banner */}
      <div
        className={`px-4 py-2 text-center text-sm font-bold ${
          protectionMode
            ? 'bg-green-900/30 text-green-400 border-b border-green-900'
            : 'bg-red-900/30 text-red-400 border-b border-red-900'
        }`}
      >
        {protectionMode
          ? '🛡️ PROTECTED MODE — All attacks will be blocked by the reverse proxy'
          : '⚠️ UNPROTECTED MODE — Attacks will succeed and cause damage'}
      </div>

      {/* Attack Panels Grid */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DDoSPanel />
          <SQLPanel />
          <XSSPanel />
          <BruteForcePanel />
        </div>

        {/* Server Log */}
        <ServerLog />
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-gray-700 py-6 border-t border-gray-900">
        CyberAttack Demo Dashboard — Educational purposes only
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ProtectionProvider>
      <Dashboard />
    </ProtectionProvider>
  );
}
