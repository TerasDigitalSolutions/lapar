import { defineMessages } from '../../i18n';

type Key =
  | 'title' | 'shops' | 'no_shops' | 'back' | 'sign_out' | 'not_authorised' | 'not_authorised_body' | 'inactive'
  | 'plan_basic' | 'plan_pro' | 'last_order' | 'no_orders' | 'no_owner' | 'owners'
  | 'new_shop' | 'shop_name' | 'shop_slug' | 'shop_slug_hint' | 'owner_email' | 'create_shop' | 'creating'
  | 'name_required' | 'slug_invalid' | 'email_invalid' | 'shop_created_link_failed'
  | 'invite_owner' | 'reset_password' | 'link_title' | 'link_once' | 'link_expires' | 'copy' | 'copied' | 'copy_failed' | 'share_whatsapp' | 'share_message'
  | 'plan' | 'plan_changed' | 'deactivate' | 'activate' | 'deactivate_title' | 'deactivate_body' | 'shop_deactivated' | 'shop_activated'
  | 'overrides' | 'overrides_hint' | 'plan_value' | 'override_value' | 'override' | 'edit' | 'remove' | 'on' | 'off' | 'unlimited' | 'none'
  | 'note' | 'note_hint' | 'note_required' | 'limit_value' | 'limit_hint' | 'limit_invalid' | 'save' | 'cancel' | 'changed_by' | 'override_saved' | 'override_removed' | 'override_title'
  | 'settings' | 'whatsapp' | 'whatsapp_hint' | 'whatsapp_saved'
  | 'err_slug_taken' | 'err_forbidden' | 'err_not_signed_in' | 'err_not_found' | 'err_invalid_input' | 'err_network' | 'err_unknown';

export const useAdminT = defineMessages<Key>('admin', {
  en: {
    title: 'Teras admin', shops: 'Shops', no_shops: 'No shops yet. Create the first one below.', back: 'Back to shops', sign_out: 'Sign out',
    not_authorised: 'Not authorised', not_authorised_body: 'This account is not a Teras platform admin.', inactive: 'Inactive',
    plan_basic: 'Basic', plan_pro: 'Pro', last_order: 'Last order {when}', no_orders: 'No orders yet', no_owner: 'No owner yet', owners: 'Owners',
    new_shop: 'New shop', shop_name: 'Shop name', shop_slug: 'Shop code', shop_slug_hint: 'Staff type this to sign in. Lowercase letters, numbers and dashes, 3 to 30 characters.',
    owner_email: 'Owner email', create_shop: 'Create shop and owner link', creating: 'Creating…',
    name_required: 'Enter the shop name.', slug_invalid: 'Use 3 to 30 lowercase letters, numbers or dashes.', email_invalid: 'Enter a valid email address.',
    shop_created_link_failed: 'The shop was created, but the owner link could not be made. Use Invite owner below.',
    invite_owner: 'Invite owner', reset_password: 'Reset password', link_title: 'Sign-in link for {email}',
    link_once: 'This link works once. The first person to open it signs in, so send it only to the owner.',
    link_expires: 'It expires in {hours} hours. Make a new link if it is not used in time.',
    copy: 'Copy link', copied: 'Link copied', copy_failed: 'Could not copy. Select the link and copy it by hand.',
    share_whatsapp: 'Share on WhatsApp',
    share_message: 'Welcome to Lapar. Open this link to set up your password (works once, expires in {hours} hours): {url}',
    plan: 'Plan', plan_changed: 'Plan changed',
    deactivate: 'Deactivate shop', activate: 'Reactivate shop', deactivate_title: 'Deactivate {name}?',
    deactivate_body: 'Customers will see "Not taking orders" until you reactivate the shop. Nothing is deleted.',
    shop_deactivated: 'Shop deactivated', shop_activated: 'Shop reactivated',
    overrides: 'Feature overrides', overrides_hint: 'An override replaces the plan value for one shop. Every change needs a note.',
    plan_value: 'Plan', override_value: 'Override', override: 'Override', edit: 'Edit', remove: 'Remove', on: 'On', off: 'Off', unlimited: 'Unlimited', none: 'None',
    note: 'Note', note_hint: 'Why, for example "Bill split add-on". Up to 200 characters.', note_required: 'A note is required.',
    limit_value: 'Limit', limit_hint: 'Leave empty for unlimited.', limit_invalid: 'Enter a whole number, 0 or more.',
    save: 'Save', cancel: 'Cancel', changed_by: 'Changed by {who} on {when}', override_saved: 'Override saved', override_removed: 'Override removed', override_title: 'Override {key}',
    settings: 'Platform settings', whatsapp: 'Ask Teras WhatsApp number',
    whatsapp_hint: 'Digits with country code, no plus sign. Owners see an "Ask Teras" link to this number. Leave empty to hide it.',
    whatsapp_saved: 'WhatsApp number saved',
    err_slug_taken: 'That shop code is already used. Pick another.', err_forbidden: 'This account is not allowed to do that.',
    err_not_signed_in: 'Your session ended. Sign in again.', err_not_found: 'We could not find that. Refresh and try again.',
    err_invalid_input: 'Something in that is not valid. Check it and try again.', err_network: 'No connection. Try again.', err_unknown: 'Something went wrong. Try again.',
  },
});
