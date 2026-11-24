// Single place for site-wide constants. Only public values; never secrets.
const base = import.meta.env.BASE_URL;

export const SITE_BASE_URL = base === '/lapar/' ? 'https://terasdigitalsolutions.github.io/lapar/' : `${location.origin}${base}`;
export const SUPABASE_URL = 'https://lxcnmbcqdafhmhqimkgj.supabase.co';
export const SUPABASE_PUBLIC_KEY: string = import.meta.env.VITE_SUPABASE_PUBLIC_KEY ?? ''; // filled in M3
