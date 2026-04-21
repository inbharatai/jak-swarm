'use client';

import { useEffect, useState } from 'react';

type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export function useStillMode() {
  const [stillMode, setStillMode] = useState(false);

  useEffect(() => {
    const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const smallViewport = window.matchMedia('(max-width: 640px)');
    const connection = (navigator as { connection?: NetworkInformation }).connection;

    const update = () => {
      const effectiveType = connection?.effectiveType ?? '';
      const saveData = Boolean(connection?.saveData);
      const lowNet = saveData || effectiveType.includes('2g');
      const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
      const hardwareConcurrency = navigator.hardwareConcurrency ?? 0;
      const lowMemory = typeof deviceMemory === 'number' ? deviceMemory <= 4 : false;
      const lowCpu = hardwareConcurrency > 0 ? hardwareConcurrency <= 4 : false;
      const isCompact = smallViewport.matches;

      setStillMode(prefersReduce.matches || (isCompact && (lowNet || lowMemory || lowCpu)));
    };

    update();
    prefersReduce.addEventListener?.('change', update);
    smallViewport.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    connection?.addEventListener?.('change', update);

    return () => {
      prefersReduce.removeEventListener?.('change', update);
      smallViewport.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
      connection?.removeEventListener?.('change', update);
    };
  }, []);

  return stillMode;
}
