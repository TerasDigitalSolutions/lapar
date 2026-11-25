/** Staff codes: 8 characters, no 0/O/1/I/L; shown as XXXX-XXXX. Matches the database's normalisation. */
export const normalizeStaffCode = (s: string): string => s.replace(/[\s-]/g, '').toUpperCase();

export const formatStaffCode = (s: string): string => {
  const c = normalizeStaffCode(s);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Demo only: the database generates real codes. */
export const newStaffCode = (): string => Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
