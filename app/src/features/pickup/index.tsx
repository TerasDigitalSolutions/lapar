import { useParams } from 'react-router';
import { DataProvider } from '../../data/context';
import { getSupabaseData } from '../../data/supabase';
import { PickupBoardView } from './PickupBoardView';

export default function PickupRoute() {
  const { token = '' } = useParams();
  return (
    <DataProvider value={getSupabaseData()}>
      <PickupBoardView boardToken={token} />
    </DataProvider>
  );
}
