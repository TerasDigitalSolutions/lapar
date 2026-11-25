import { DataProvider } from '../../data/context';
import { getSupabaseData } from '../../data/supabase';
import { StaffGate } from './StaffGate';

export default function StaffRoute() {
  return (
    <DataProvider value={getSupabaseData()}>
      <StaffGate />
    </DataProvider>
  );
}
