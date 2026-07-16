import { useState, useEffect } from 'react';

/** Counts down to `targetDate` and returns a formatted string (e.g. "2d 03:14:05").
 *  Returns "N/A" when no date is provided and "Now" when the target has passed. */
export function useCountdown(targetDate: string | undefined): string {
  const [remaining, setRemaining] = useState('--:--:--');

  useEffect(() => {
    if (!targetDate) {
      setRemaining('N/A');
      return;
    }
    const target = new Date(targetDate).getTime();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formatDiff = (diff: number) => {
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    };
    const diff0 = target - Date.now();
    if (diff0 <= 0) {
      setRemaining('Now');
      return;
    }
    setRemaining(formatDiff(diff0));
    const id = setInterval(() => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setRemaining('Now');
        clearInterval(id);
        return;
      }
      setRemaining(formatDiff(diff));
    }, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return remaining;
}
