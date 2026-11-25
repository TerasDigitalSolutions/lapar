import { createContext, useContext, type ReactNode } from 'react';
import type { LaparData } from './types';

const DataContext = createContext<LaparData | null>(null);

export function DataProvider({ value, children }: { value: LaparData; children: ReactNode }) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): LaparData {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData() must be used inside <DataProvider>');
  return value;
}
