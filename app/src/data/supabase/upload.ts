import { LaparError } from '../types';

/** Photo/logo upload to Storage; filled by M3-B. */
export function uploadFile(): Promise<never> {
  return Promise.reject(new LaparError('not_implemented'));
}
