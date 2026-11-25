import { defineMessages } from '../i18n';
import type { LaparErrorCode } from '../data/types';

type ErrorKey = `err_${LaparErrorCode}`;
type Key =
  | ErrorKey
  | 'close' | 'cancel' | 'confirm' | 'retry' | 'loading' | 'pro' | 'pro_title' | 'pro_body' | 'pro_cta_demo'
  | 'pro_cta_whatsapp' | 'pro_cta_neutral' | 'got_it' | 'increase' | 'decrease' | 'quantity' | 'limit_used' | 'error_title';

export const useUiT = defineMessages<Key>('ui', {
  en: {
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    retry: 'Try again',
    loading: 'Loading',
    pro: 'Pro',
    pro_title: '{feature} is part of Lapar Pro',
    pro_body: 'Your shop is on Lapar Basic. {description}',
    pro_cta_demo: 'Switch the plan to Pro to try it.',
    pro_cta_whatsapp: 'Ask Teras about Lapar Pro',
    pro_cta_neutral: 'Ask Teras about Lapar Pro.',
    got_it: 'Got it',
    increase: 'Add one',
    decrease: 'Remove one',
    quantity: 'Quantity',
    limit_used: '{used} of {limit} used',
    error_title: 'Something went wrong',
    err_not_found: 'We could not find that. The link or QR code may be out of date.',
    err_forbidden: 'You are not allowed to do that.',
    err_not_signed_in: 'Please sign in to continue.',
    err_shop_inactive: 'This shop is not taking orders right now.',
    err_feature_not_enabled: 'This is part of Lapar Pro.',
    err_limit_reached: 'You have reached the limit for your plan.',
    err_invalid_input: 'Something in that is not valid. Please check and try again.',
    err_item_unavailable: 'That dish is not available right now.',
    err_sold_out: 'Sorry, that dish is sold out.',
    err_rate_limited: 'Too many orders just now. Please wait a moment and try again.',
    err_invalid_pin: 'That PIN is not right.',
    err_pin_locked: 'Too many wrong PINs. Please wait a few minutes.',
    err_duplicate_pin: 'Another staff member already uses that PIN.',
    err_invalid_transition: 'That cannot be done at this step. Refresh and try again.',
    err_tab_closed: 'This bill is already closed.',
    err_pending_orders: 'Some orders are still waiting for approval.',
    err_outside_report_window: 'That date is outside your plan’s report history.',
    err_in_use: 'That is still in use, so it cannot be removed.',
    err_slug_taken: 'That shop address is already taken.',
    err_network: 'No connection. Check your internet and try again.',
    err_not_implemented: 'This is not available yet.',
    err_unknown: 'Something went wrong. Please try again.',
  },
});
