import { defineMessages } from '../../i18n';

type Key =
  | 'start_title' | 'start_body' | 'start_button'
  | 'banner_sound' | 'banner_sound_action' | 'banner_wake' | 'banner_offline'
  | 'col_new' | 'col_preparing' | 'col_cooking' | 'col_ready'
  | 'empty_column' | 'position' | 'minutes' | 'from_set' | 'next_to' | 'served'
  | 'menu_title' | 'menu_open' | 'move_back' | 'cancel_item'
  | 'print_ticket' | 'station_picker'
  | 'cancel_title' | 'cancel_body' | 'cancel_confirm' | 'keep';

export const useKitchenT = defineMessages<Key>('kitchen', {
  en: {
    start_title: 'Kitchen board',
    start_body: 'Tap to turn on sound, keep the screen awake and go full screen.',
    start_button: 'Start shift',
    banner_sound: 'Sound is off. You will not hear new orders.',
    banner_sound_action: 'Turn on sound',
    banner_wake: 'This device cannot keep the screen awake. Change its screen timeout to never.',
    banner_offline: 'No connection. The board may be out of date.',
    col_new: 'New',
    col_preparing: 'Preparing',
    col_cooking: 'Cooking',
    col_ready: 'Ready',
    empty_column: 'Nothing here',
    position: '{n} of {total}',
    minutes: '{n} min',
    from_set: 'Part of {name}',
    next_to: 'Tap: {name}',
    served: 'Served',
    menu_title: 'More for {name}',
    menu_open: 'More options for {name}',
    move_back: 'Move back to {name}',
    cancel_item: 'Cancel this item',
    cancel_title: 'Cancel {name}?',
    cancel_body: 'This removes it from the board and from the bill.',
    cancel_confirm: 'Cancel item',
    keep: 'Keep it',
    print_ticket: 'Print ticket',
    station_picker: 'Station',
  },
});
