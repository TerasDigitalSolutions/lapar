import { defineMessages } from '../../i18n';

type Key =
  | 'signin_title' | 'signin_intro' | 'email' | 'password' | 'signin_submit' | 'signin_wrong' | 'signin_failed'
  | 'email_required' | 'password_required' | 'staff_warning'
  | 'welcome_title_email' | 'welcome_title_recovery' | 'welcome_checking' | 'welcome_invalid'
  | 'new_password' | 'new_password_hint' | 'confirm_password' | 'password_short' | 'password_mismatch'
  | 'set_password_submit' | 'set_password_failed' | 'to_signin'
  | 'no_shop' | 'sign_out' | 'pick_shop' | 'switch_shop' | 'shop_paused' | 'staff_signed_in_as';

export const useAuthT = defineMessages<Key>('auth', {
  en: {
    signin_title: 'Owner sign in', signin_intro: 'Use the email and password you set up with Teras.',
    email: 'Email', password: 'Password', signin_submit: 'Sign in',
    signin_wrong: 'That email or password is not right.', signin_failed: 'Could not sign in. Check your connection and try again.',
    email_required: 'Enter your email.', password_required: 'Enter your password.',
    staff_warning: 'This phone is signed in as staff. Signing in as owner will sign the staff member out.',
    welcome_title_email: 'Welcome to Lapar', welcome_title_recovery: 'Reset your password',
    welcome_checking: 'Checking your link…',
    welcome_invalid: 'This link has expired or was already used. Ask Teras for a new one.',
    new_password: 'New password', new_password_hint: 'At least 8 characters', confirm_password: 'Type it again',
    password_short: 'Use at least 8 characters.', password_mismatch: 'The two passwords are not the same.',
    set_password_submit: 'Save password and continue', set_password_failed: 'Could not save the password. Try again.',
    to_signin: 'Go to sign in',
    no_shop: 'No shop is linked to this account. Ask Teras for help.',
    sign_out: 'Sign out', pick_shop: 'Choose a shop', switch_shop: 'Switch shop', shop_paused: 'paused',
    staff_signed_in_as: 'Signed in as {name}',
  },
});
