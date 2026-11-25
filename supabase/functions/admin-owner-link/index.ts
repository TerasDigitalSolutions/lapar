// Creates owners and one-time sign-in links (no email is sent). DATA-MODEL 6.7.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://terasdigitalsolutions.github.io', 'http://localhost:5173'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const secretKey =
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });

  try {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return send(401, { error: 'not_signed_in' });
    const { data: caller } = await admin.auth.getUser(jwt);
    if (!caller.user) return send(401, { error: 'not_signed_in' });
    const { data: isAdmin } = await admin
      .from('platform_admins').select('user_id').eq('user_id', caller.user.id).maybeSingle();
    if (!isAdmin) return send(403, { error: 'forbidden' });

    let body: { shopId?: unknown; email?: unknown; mode?: unknown };
    try { body = await req.json(); } catch { return send(400, { error: 'invalid_input', detail: 'body' }); }
    const { shopId, mode } = body;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (typeof shopId !== 'string' || !UUID_RE.test(shopId)) return send(400, { error: 'invalid_input', detail: 'shopId' });
    if (!EMAIL_RE.test(email) || email.length > 254) return send(400, { error: 'invalid_input', detail: 'email' });
    if (mode !== 'invite' && mode !== 'reset') return send(400, { error: 'invalid_input', detail: 'mode' });

    const { data: shop } = await admin.from('shops').select('id').eq('id', shopId).maybeSingle();
    if (!shop) return send(404, { error: 'not_found', detail: 'shop' });

    if (mode === 'invite') {
      const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error && error.code !== 'email_exists') return send(500, { error: 'internal' });
      const { data, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (linkErr || !data.user) return send(500, { error: 'internal' });
      const { error: ownErr } = await admin
        .from('shop_owners').upsert({ shop_id: shopId, user_id: data.user.id }, { onConflict: 'shop_id,user_id' });
      if (ownErr) return send(500, { error: 'internal' });
      return send(200, { email, mode, tokenHash: data.properties.hashed_token, verifyType: 'email' });
    }

    // reset: the user must already own this shop
    const { data: owners } = await admin.from('shop_owners').select('user_id').eq('shop_id', shopId);
    const { data, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    // generateLink errors for unknown emails; treat that the same as "not an owner"
    if (linkErr || !data.user || !owners?.some((o) => o.user_id === data.user.id)) {
      return send(404, { error: 'not_found', detail: 'owner' });
    }
    return send(200, { email, mode, tokenHash: data.properties.hashed_token, verifyType: 'recovery' });
  } catch (_e) {
    return send(500, { error: 'internal' });
  }
});
