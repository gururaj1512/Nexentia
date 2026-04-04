import { motion, AnimatePresence } from 'framer-motion';

interface ToastProps {
  show: boolean;
  message: string;
  type: 'success' | 'warning';
}

export default function Toast({ show, message, type }: ToastProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full font-bold text-sm shadow-lg ${
            type === 'success'
              ? 'bg-green-600 text-white shadow-green-900/50'
              : 'bg-orange-600 text-white shadow-orange-900/50'
          }`}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
