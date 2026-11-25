import type { EntitlementKey } from './keys';

/** English label and one-line description for every feature and limit key (Pro sheets, Plan page). */
export const ENTITLEMENT_TEXT: Record<EntitlementKey, { label: string; description: string }> = {
  qr_ordering: { label: 'QR ordering', description: 'Customers scan the table QR and order from their phone.' },
  modifiers: { label: 'Options', description: 'Sizes, sugar level, add-ons and other choices per dish.' },
  call_server: { label: 'Call a server', description: 'Customers ask for the bill or water from the table.' },
  approvals: { label: 'Order approval', description: 'Staff can approve orders before they reach the kitchen.' },
  kitchen_board: { label: 'Kitchen board', description: 'A live board of orders for the kitchen tablet.' },
  manual_pairings: { label: 'Suggested pairings', description: 'Suggest up to three dishes to go with each item.' },
  checkout_nudge: { label: 'Checkout nudge', description: 'Offer a category such as drinks before the customer orders.' },
  manual_payments: { label: 'Record payments', description: 'Mark bills paid by cash, DuitNow, card or other.' },
  daily_summary: { label: 'Daily summary', description: "Today's sales, bills and best sellers." },
  menu_editor: { label: 'Menu editor', description: 'Edit categories, dishes, prices and photos.' },
  table_qr: { label: 'Table QR codes', description: 'Print a QR code for every table.' },
  staff_pins: { label: 'Staff PINs', description: 'Staff sign in with a short PIN.' },
  auto_pairings: { label: 'Auto pairings', description: 'Suggest dishes that are often ordered together.' },
  upsell_report: { label: 'Upsell report', description: 'See how often suggestions are added to orders.' },
  combos: { label: 'Set meals', description: 'Sell a set of dishes at one price.' },
  promos: { label: 'Promotions', description: 'Happy hour and other discounts on chosen dishes.' },
  timed_menus: { label: 'Timed menus', description: 'Show breakfast, lunch or dinner dishes only at their hours.' },
  multi_language_menu: { label: 'Menu languages', description: 'Customers switch the menu between languages.' },
  multi_station: { label: 'Several stations', description: 'Send dishes to different stations such as Drinks and Kitchen.' },
  printing: { label: 'Printing', description: 'Print receipts and kitchen slips from the browser.' },
  takeaway: { label: 'Takeaway', description: 'A counter QR for takeaway orders with pickup numbers.' },
  bill_split: { label: 'Split the bill', description: 'Split a bill equally or by item, with several payments.' },
  custom_columns: { label: 'Custom board columns', description: 'Rename or add columns on the kitchen board.' },
  full_reports: { label: 'Full reports', description: 'Sales, busy hours, best sellers and prep times over time.' },
  export_backup: { label: 'Export and backup', description: 'Download your orders and menu as CSV or JSON.' },
  max_tables: { label: 'Tables', description: 'How many tables the shop can have.' },
  max_stations: { label: 'Stations', description: 'How many kitchen stations the shop can have.' },
  max_staff: { label: 'Staff', description: 'How many staff members the shop can have.' },
  report_history_days: { label: 'Report history (days)', description: 'How many days of reports are available.' },
};

export const entitlementLabel = (key: EntitlementKey): string => ENTITLEMENT_TEXT[key].label;
export const entitlementDescription = (key: EntitlementKey): string => ENTITLEMENT_TEXT[key].description;
