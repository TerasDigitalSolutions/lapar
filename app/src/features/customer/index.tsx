import { useParams } from 'react-router';
import { DataProvider } from '../../data/context';
import { getSupabaseData } from '../../data/supabase';
import { CustomerView } from './CustomerView';

export default function CustomerRoute() {
  const { token = '' } = useParams();
  // No `live`: the real customer page polls get_tab and never loads supabase-js.
  return (
    <DataProvider value={getSupabaseData()}>
      <CustomerView tableToken={token} />
    </DataProvider>
  );
}
