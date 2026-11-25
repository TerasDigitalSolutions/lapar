import { DataProvider } from '../../data/context';
import { getSupabaseData } from '../../data/supabase';
import { ManagerGate } from './ManagerGate';

export default function ManagerRoute() {
  return (
    <DataProvider value={getSupabaseData()}>
      <ManagerGate />
    </DataProvider>
  );
}
