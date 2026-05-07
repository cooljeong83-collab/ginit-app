import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), Math.max(0, delayMs));
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}

