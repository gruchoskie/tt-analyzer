import { useCallback, useState } from 'react';

/** Preferências do usuário neste aparelho (localStorage, com tolerância a falhas). */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`tt.pref.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`tt.pref.${key}`, JSON.stringify(v));
      } catch {
        /* ignora */
      }
    },
    [key],
  );
  return [value, set];
}
