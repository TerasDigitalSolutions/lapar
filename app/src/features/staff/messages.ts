import { defineMessages } from '../../i18n';

type Key =
  | 'tab_orders' | 'tab_kitchen' | 'tab_tables' | 'tab_soldout' | 'tabs_label' | 'action_failed'
  | 'enable_sound' | 'enable_sound_btn'
  | 'approvals' | 'no_approvals' | 'approve' | 'reject' | 'waiting_min' | 'just_now' | 'pickup_no'
  | 'reject_title' | 'reject_free' | 'reject_free_hint' | 'reject_confirm'
  | 'reason_sold_out' | 'reason_closed' | 'reason_busy' | 'reason_required'
  | 'calls' | 'no_calls' | 'call_bill' | 'call_water' | 'call_other' | 'call_taps' | 'ack' | 'done' | 'call_ack'
  | 'to_serve' | 'nothing_to_serve' | 'serve' | 'serve_aria'
  | 'tables_empty' | 'table_free' | 'tab_pending' | 'tab_ready' | 'tab_calls'
  | 'tab_detail' | 'order_n' | 'order_pending' | 'order_rejected' | 'total' | 'paid' | 'remaining'
  | 'pending_warning' | 'mark_paid' | 'pay_method' | 'm_cash' | 'm_duitnow' | 'm_card' | 'm_other'
  | 'pay_collect' | 'pay_rounding' | 'pay_confirm' | 'paid_closed' | 'nothing_owed'
  | 'err_mixed_split' | 'print_ticket' | 'print_bill' | 'pickup_time' | 'pickup_board_open' | 'pickup_board_close'
  | 'split_mode' | 'split_full' | 'split_items' | 'split_equal' | 'split_items_hint' | 'split_people' | 'split_share'
  | 'soldout_hint' | 'soldout_empty' | 'soldout_on'
  | 'pin_title' | 'pin_shop' | 'pin_shop_hint' | 'pin_pin' | 'pin_digits' | 'pin_backspace' | 'pin_submit'
  | 'pin_shop_required' | 'pin_len' | 'pin_wrong' | 'pin_locked' | 'pin_not_found' | 'pin_failed';

export const useStaffT = defineMessages<Key>('staff', {
  en: {
    tab_orders: 'Orders', tab_kitchen: 'Kitchen', tab_tables: 'Tables', tab_soldout: 'Sold out', tabs_label: 'Staff sections', action_failed: 'That did not go through. Please check and try again.',
    enable_sound: 'Sound is off. You will not hear new orders.', enable_sound_btn: 'Tap to enable sound',
    approvals: 'Waiting for approval', no_approvals: 'No orders waiting.', approve: 'Approve', reject: 'Reject',
    waiting_min: '{n} min waiting', just_now: 'Just now', pickup_no: 'Pickup #{n}',
    reject_title: 'Reject order', reject_free: 'Other reason', reject_free_hint: 'Up to 140 characters',
    reject_confirm: 'Reject order',
    reason_sold_out: 'Sold out', reason_closed: 'Kitchen closed', reason_busy: 'Too busy',
    reason_required: 'Pick or write a reason.',
    calls: 'Calls', no_calls: 'No calls.', call_bill: 'Bill please', call_water: 'Water', call_other: 'Needs help',
    call_taps: 'Tapped {n} times', ack: 'On my way', done: 'Done', call_ack: 'On the way',
    to_serve: 'Ready to serve', nothing_to_serve: 'Nothing ready.', serve: 'Served', serve_aria: 'Mark {name} served',
    tables_empty: 'No tables.', table_free: 'Free', tab_pending: '{n} waiting', tab_ready: '{n} ready',
    tab_calls: '{n} call(s)',
    tab_detail: 'Bill', order_n: 'Order {n}', order_pending: 'Waiting for approval', order_rejected: 'Rejected: {reason}',
    total: 'Total', paid: 'Paid', remaining: 'Left to pay',
    pending_warning: 'An order is still waiting for approval. Approve or reject it before paying.',
    mark_paid: 'Mark paid', pay_method: 'How did they pay?', m_cash: 'Cash', m_duitnow: 'DuitNow QR', m_card: 'Card', m_other: 'Other',
    pay_collect: 'Collect {amount}', pay_rounding: 'Rounding {amount}', pay_confirm: 'Confirm paid',
    paid_closed: 'Paid. The bill is closed.', nothing_owed: 'Nothing left to pay.',
    err_mixed_split: 'Part of this bill was paid by amount, so it cannot also be split by item.',
    print_ticket: 'Print ticket', print_bill: 'Print bill', pickup_time: 'Pickup {time}',
    pickup_board_open: 'Open pickup board', pickup_board_close: 'Close pickup board',
    split_mode: 'How to pay', split_full: 'Whole bill', split_items: 'By item', split_equal: 'Equally',
    split_items_hint: 'Tick what this person is paying for.', split_people: 'People', split_share: 'Share for one of {n} still to pay',
    soldout_hint: 'Switch on what has run out. Customers will not be able to order it.', soldout_empty: 'No dishes yet.',
    soldout_on: 'Sold out',
    pin_title: 'Staff sign in', pin_shop: 'Staff code', pin_shop_hint: 'The owner gives you this code. You only type it once on this device.',
    pin_pin: 'PIN', pin_digits: '{n} digits entered', pin_backspace: 'Delete last digit', pin_submit: 'Sign in',
    pin_shop_required: 'Enter the staff code.', pin_len: 'The PIN is 4 to 6 digits.',
    pin_wrong: 'That PIN is not right.', pin_locked: 'Too many wrong PINs. Try again at {time}.',
    pin_not_found: 'That staff code is not right. Ask the owner for the current code.', pin_failed: 'Could not sign in. Check your connection and try again.',
  },
});
