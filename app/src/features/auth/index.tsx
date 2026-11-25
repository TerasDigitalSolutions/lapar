import { useNavigate, useSearchParams } from 'react-router';
import { DataProvider } from '../../data/context';
import { getSupabaseData } from '../../data/supabase';
import { WelcomeView } from './WelcomeView';

export default function WelcomeRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <DataProvider value={getSupabaseData()}>
      <WelcomeView tokenHash={params.get('token_hash')} type={params.get('type')} onDone={() => void navigate('/manage')} />
    </DataProvider>
  );
}
