/**
 * Lapar data contract: domain types, DTOs and the `LaparData` interface.
 *
 * Every screen gets data only through `LaparData` (via `useData()` from ./context.tsx).
 * Two implementations share all UI code:
 *   - DemoData      app/src/data/demo/      in memory + localStorage; the offline demo. No network.
 *   - SupabaseData  app/src/data/supabase/  Postgres RPCs, PostgREST and Realtime; the real app.
 * This file must never import supabase-js (or anything with side effects).
 *
 * Conventions (docs/DATA-MODEL.md has the SQL side):
 * - Money is integer sen (`Sen`): never floats, never formatted strings. Format only in the UI.
 * - Ids are UUID strings. Timestamps are ISO 8601 with offset (`IsoDateTime`).
 * - Calendar days are Asia/Kuala_Lumpur (MYT) dates 'YYYY-MM-DD' (`IsoDate`).
 *   Times of day are MYT 'HH:MM' (`HHMM`). ISO weekday: 1 = Monday ... 7 = Sunday.
 * - RPC results are JSON whose keys are exactly the camelCase field names of the DTO named in
 *   each method's doc comment, so SupabaseData passes them through without renaming.
 *   Direct table reads (owner screens) come back snake_case and SupabaseData maps them.
 * - Every method rejects with `LaparError` (never a raw supabase or fetch error).
 * - "Pro: <key>" in a comment means the server rejects the call with
 *   `feature_not_enabled` (detail = key) unless the shop's entitlements enable that key.
 */

import type { EntitlementKey, Entitlements, FeatureKey, LimitKey, PlanId } from '../entitlements/keys';

export type { EntitlementKey, Entitlements, FeatureKey, LimitKey, PlanId };

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** Integer sen (RM 1.00 = 100). Always a safe integer >= 0 unless a field says otherwise. */
export type Sen = number;
export type Uuid = string;
export type IsoDateTime = string;
/** MYT calendar day, 'YYYY-MM-DD'. */
export type IsoDate = string;
/** MYT time of day, 'HH:MM' (24 h). */
export type HHMM = string;
/** 1 = Monday ... 7 = Sunday (Postgres `isodow`). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Customer-facing menu languages. 'en' is the shop's own text; others come from `translations`. */
export type Lang = 'en' | 'ms' | 'zh';

/**
 * Owner-entered translations (column `translations jsonb`). Missing entries fall back to the
 * default `name` / `description`. Only returned to customers when `multi_language_menu` is on.
 */
export type Translations = Partial<Record<'ms' | 'zh', { name?: string; description?: string }>>;

// ---------------------------------------------------------------------------------------------
// Enums (string unions identical to the Postgres enum labels)
// ---------------------------------------------------------------------------------------------

export type ApprovalMode = 'every_order' | 'first_order' | 'none';
export type TabStatus = 'open' | 'closed';
/** 'cancelled' is reserved; v1 never sets it (staff cancel lines, not orders). */
export type OrderStatus = 'pending_approval' | 'approved' | 'rejected' | 'cancelled';
export type ItemStatus = 'pending' | 'new' | 'preparing' | 'cooking' | 'ready' | 'served' | 'cancelled';
/** The four core statuses that have kitchen board columns. */
export type BoardStatus = 'new' | 'preparing' | 'cooking' | 'ready';
export const CORE_BOARD_STATUSES: readonly BoardStatus[] = ['new', 'preparing', 'cooking', 'ready'];
export type ServiceReason = 'bill' | 'water' | 'other';
export type ServiceStatus = 'open' | 'acknowledged' | 'done';
export type PhotoState = 'none' | 'staging' | 'published';
export type PaidMethod = 'cash' | 'duitnow' | 'card' | 'other';
/** 'counter' = takeaway counter QR (Pro: takeaway). */
export type TableKind = 'table' | 'counter';
/** 'combo' = priced set line (not on the board); 'component' = its zero-priced parts (on the board). */
export type LineKind = 'item' | 'combo' | 'component';
export type DiscountType = 'percent' | 'amount';

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * Machine codes. SQL raises `raise exception '<code>' using detail = '<detail>'`; SupabaseData
 * maps the PostgREST error `message` to this code (unknown messages become 'unknown').
 */
export const LAPAR_ERROR_CODES = [
  'not_found', // token or id unknown, inactive table, or not visible to the caller
  'forbidden', // signed in, but not an owner/staff/admin allowed to do this
  'not_signed_in',
  'shop_inactive', // shop deactivated by Teras: "Not taking orders"
  'feature_not_enabled', // detail: FeatureKey
  'limit_reached', // detail: LimitKey
  'invalid_input', // detail: field or reason
  'item_unavailable', // detail: item id (inactive, wrong shop, outside its time window)
  'sold_out', // detail: item id
  'rate_limited', // too many orders from one table
  'invalid_pin',
  'pin_locked', // detail: ISO time the lock ends
  'duplicate_pin', // another active staff member in the shop has this PIN
  'invalid_transition', // e.g. advance_item move not allowed, approve a non-pending order
  'tab_closed',
  'pending_orders', // tab still has orders waiting for approval
  'outside_report_window', // date before report_history_days allows
  'in_use', // e.g. delete a category that still has items
  'slug_taken',
  'network', // client side: offline, fetch failed, timeout
  'not_implemented', // stub, or DemoData method the demo does not support
  'unknown',
] as const;
export type LaparErrorCode = (typeof LAPAR_ERROR_CODES)[number];

export class LaparError extends Error {
  readonly code: LaparErrorCode;
  readonly detail: string | undefined;

  constructor(code: LaparErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'LaparError';
    this.code = code;
    this.detail = detail;
  }
}

export function isLaparError(error: unknown, code?: LaparErrorCode): error is LaparError {
  return error instanceof LaparError && (code === undefined || error.code === code);
}

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

/** A category (or promo) availability window in MYT. `to` earlier than `from` wraps past midnight. */
export interface TimeWindow {
  from: HHMM;
  to: HHMM;
  /** null = every day */
  days: IsoWeekday[] | null;
}

/** Snapshot of one chosen option, stored on the order line (`order_items.options` jsonb array). */
export interface LineOption {
  groupId: Uuid;
  groupName: string;
  optionId: Uuid;
  name: string;
  priceDeltaSen: Sen;
}

// ---------------------------------------------------------------------------------------------
// Customer (anon, table token)
// ---------------------------------------------------------------------------------------------

/** RPC get_menu(p_table_token). One call loads the whole customer page. */
export type ShopTheme = 'kopitiam' | 'pandan' | 'teh-tarik' | 'malam';

export interface MenuDTO {
  shop: {
    id: Uuid;
    theme: ShopTheme;
    name: string;
    slug: string;
    logoUrl: string | null;
    /** false: show "Not taking orders"; categories and items are then empty. */
    active: boolean;
    /** Checkout nudge category; null when unset or `checkout_nudge` is off. */
    nudgeCategoryId: Uuid | null;
  };
  table: { label: string; kind: TableKind };
  /** The shop's resolved feature switches (limits are not sent to customers). */
  features: Record<FeatureKey, boolean>;
  /** Shop order (sort, then name). */
  categories: MenuCategory[];
  /** Active items only (combos only when `combos` is on), category order then sort. */
  items: MenuItem[];
  serverNow: IsoDateTime;
}

export interface MenuCategory {
  id: Uuid;
  name: string;
  /** {} unless `multi_language_menu` is on. */
  translations: Translations;
  sort: number;
  /** null unless `timed_menus` is on and the category has a window. */
  window: TimeWindow | null;
  /** false when outside its window (items are shown greyed and cannot be ordered). */
  availableNow: boolean;
}

export interface MenuItem {
  id: Uuid;
  categoryId: Uuid;
  name: string;
  description: string;
  translations: Translations;
  /** List price. */
  priceSen: Sen;
  /** Price charged now: list price minus the best active promo (== priceSen without one). */
  effectivePriceSen: Sen;
  /** Active promo now (Pro: promos), for the struck-through price and its label. */
  promo: { id: Uuid; name: string; translations: Translations; endsAt: IsoDateTime } | null;
  /** Full URL (staging) or site-relative path (published). Resolve with lib/photo-url.ts. */
  photoUrl: string | null;
  soldOut: boolean;
  sort: number;
  groups: MenuModifierGroup[];
  /**
   * Candidate suggestions in order: manual pairings by position, then auto pairings
   * (Pro: auto_pairings). Not filtered for cart or sold out; lib/suggestions.ts picks up to 3.
   */
  suggestions: MenuSuggestion[];
  /** Set meal components (Pro: combos), else null. Combos have no option groups. */
  combo: { components: { itemId: Uuid; name: string; translations: Translations; qty: number }[] } | null;
}

export interface MenuModifierGroup {
  id: Uuid;
  name: string;
  translations: Translations;
  minSelect: number;
  maxSelect: number;
  options: MenuModifierOption[];
}

export interface MenuModifierOption {
  id: Uuid;
  name: string;
  translations: Translations;
  priceDeltaSen: Sen;
}

export interface MenuSuggestion {
  itemId: Uuid;
  /** 'auto' suggestions are labelled "Frequently ordered together". */
  source: 'manual' | 'auto';
}

/** One cart line as sent to place_order. Prices are never sent: the server computes them. */
export interface OrderLineInput {
  itemId: Uuid;
  /** 1..99 */
  qty: number;
  optionIds: Uuid[];
  /** <= 140 characters. */
  note?: string | null;
  /** Set when the line was added from a suggestion sheet (feeds the upsell report). */
  suggestedFromItemId?: Uuid | null;
}

export interface PlaceOrderInput {
  /** 1..30 lines. */
  lines: OrderLineInput[];
  /** Counter QR only (Pro: takeaway): requested pickup time, later today (MYT). */
  pickupAt?: IsoDateTime | null;
}

/** RPC place_order result, with server prices. */
export interface PlaceOrderResult {
  orderId: Uuid;
  tabId: Uuid;
  /** 'pending_approval' or 'approved', from the shop's approval mode. */
  status: OrderStatus;
  /** Counter orders only. */
  pickupNo: number | null;
  totalSen: Sen;
  lines: PricedLine[];
}

export interface PricedLine {
  lineId: Uuid;
  itemId: Uuid;
  kind: LineKind;
  name: string;
  qty: number;
  listPriceSen: Sen;
  unitPriceSen: Sen;
  optionsPriceSen: Sen;
  /** qty * (unitPriceSen + optionsPriceSen); 0 for components. */
  lineTotalSen: Sen;
  promoId: Uuid | null;
}

/** RPC get_tab(p_table_token, p_tab_id). The table's open tab (or one counter tab). */
export interface CustomerTabDTO {
  table: { label: string; kind: TableKind };
  /** null when the table has no open tab. */
  tab: {
    id: Uuid;
    status: TabStatus;
    openedAt: IsoDateTime;
    closedAt: IsoDateTime | null;
    pickupNo: number | null;
    pickupAt: IsoDateTime | null;
    /** Approved, not cancelled lines. */
    totalSen: Sen;
    /** Lines of orders still waiting for approval. */
    pendingSen: Sen;
    paidSen: Sen;
  } | null;
  /** Oldest first. */
  orders: CustomerOrderDTO[];
  /** Server calls not yet done. */
  openRequests: { reason: ServiceReason; status: ServiceStatus; createdAt: IsoDateTime }[];
  serverNow: IsoDateTime;
}

export interface CustomerOrderDTO {
  id: Uuid;
  status: OrderStatus;
  createdAt: IsoDateTime;
  rejectedReason: string | null;
  /** In line_no order; components follow their combo line. */
  lines: CustomerLineDTO[];
}

export interface CustomerLineDTO {
  id: Uuid;
  itemId: Uuid;
  kind: LineKind;
  parentLineId: Uuid | null;
  /** Name when ordered (menu edits never change past bills). */
  name: string;
  qty: number;
  options: LineOption[];
  note: string | null;
  listPriceSen: Sen;
  unitPriceSen: Sen;
  optionsPriceSen: Sen;
  lineTotalSen: Sen;
  /**
   * Customer label mapping (UI): pending = Waiting for approval, new = Received,
   * preparing/cooking = Cooking, ready = Ready, served = Served, cancelled = Cancelled.
   */
  status: ItemStatus;
}

/** RPC get_pickup_board(p_board_token) (Pro: takeaway). Numbers only, no personal data. */
export interface PickupBoardDTO {
  shopName: string;
  theme: ShopTheme;
  /** Today's (MYT) approved counter tabs not yet fully ready. Ascending. */
  preparing: number[];
  /** All lines ready (or served) but not all served yet. Ascending. */
  ready: number[];
  serverNow: IsoDateTime;
}

// ---------------------------------------------------------------------------------------------
// Auth and sessions
// ---------------------------------------------------------------------------------------------

export interface AuthUser {
  id: Uuid;
  email: string | null;
  /** Staff devices sign in anonymously. */
  isAnonymous: boolean;
}

/** RPC claim_staff_session / my_staff_session. */
export interface StaffSession {
  shopId: Uuid;
  shopName: string;
  shopSlug: string;
  shopTheme: ShopTheme;
  staffId: Uuid;
  staffName: string;
  expiresAt: IsoDateTime;
  /** The shop's pickup board token when it has `takeaway`, else null (staff pickup-board overlay). */
  pickupBoardToken: string | null;
}

/** RPC my_shops: shops where the signed-in user is an owner. */
export interface OwnerShopDTO {
  id: Uuid;
  name: string;
  slug: string;
  active: boolean;
  planId: PlanId;
  theme: ShopTheme;
}

/** Owner invite links are verified as 'email'; password reset links as 'recovery'. */
export type OwnerLinkType = 'email' | 'recovery';

// ---------------------------------------------------------------------------------------------
// Staff and kitchen
// ---------------------------------------------------------------------------------------------

export interface StaffLineDTO extends CustomerLineDTO {
  stationId: Uuid;
  /** Custom board column (Pro: custom_columns); null = first column of its status. */
  columnId: Uuid | null;
  /** Set when paid by an item split (Pro: bill_split). */
  paidPaymentId: Uuid | null;
  statusChangedAt: IsoDateTime;
}

/** RPC get_pending_orders(p_shop_id). Oldest first. */
export interface PendingOrderDTO {
  orderId: Uuid;
  tabId: Uuid;
  tableId: Uuid;
  tableLabel: string;
  tableKind: TableKind;
  pickupNo: number | null;
  pickupAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  totalSen: Sen;
  lines: StaffLineDTO[];
}

/** RPC get_service_requests(p_shop_id): status open or acknowledged, oldest first. */
export interface ServiceRequestDTO {
  id: Uuid;
  tableId: Uuid;
  tableLabel: string;
  tabId: Uuid | null;
  reason: ServiceReason;
  note: string | null;
  status: ServiceStatus;
  tapCount: number;
  createdAt: IsoDateTime;
  acknowledgedAt: IsoDateTime | null;
  /** Last tap; alerts restart when this changes. */
  updatedAt: IsoDateTime;
}

/** A board column. Fixed columns (Basic, or no custom rows) have id = null and name = null (UI label from i18n). */
export interface BoardColumnDTO {
  id: Uuid | null;
  name: string | null;
  coreStatus: BoardStatus;
  sort: number;
}

/** One kitchen card = one order line (item or combo component). */
export interface BoardLineDTO {
  id: Uuid;
  orderId: Uuid;
  tabId: Uuid;
  tableLabel: string;
  tableKind: TableKind;
  pickupNo: number | null;
  itemId: Uuid;
  name: string;
  qty: number;
  options: LineOption[];
  note: string | null;
  kind: 'item' | 'component';
  /** The set's name for a component line, else null. */
  parentName: string | null;
  status: BoardStatus;
  columnId: Uuid | null;
  stationId: Uuid;
  /** "position of positionOf" for its order (board lines, not cancelled), e.g. 2 of 4. */
  position: number;
  positionOf: number;
  /** Minutes on the card are counted from here (amber at 10, red at 20). */
  approvedAt: IsoDateTime;
  statusChangedAt: IsoDateTime;
}

/** RPC get_board(p_shop_id, p_station_id). */
export interface BoardDTO {
  stationId: Uuid;
  stationName: string;
  /** Sorted. Four fixed columns unless custom columns apply (Pro: custom_columns). */
  columns: BoardColumnDTO[];
  /** Lines with status new..ready at this station, oldest approval first. */
  lines: BoardLineDTO[];
  serverNow: IsoDateTime;
}

/** RPC get_tables_overview(p_shop_id): active tables and counters with their open tabs. */
export interface TableOverviewDTO {
  tableId: Uuid;
  label: string;
  kind: TableKind;
  openRequests: number;
  /** At most one for a table; any number (today's) for a counter. */
  openTabs: TabSummaryDTO[];
}

export interface TabSummaryDTO {
  id: Uuid;
  openedAt: IsoDateTime;
  pickupNo: number | null;
  pickupAt: IsoDateTime | null;
  totalSen: Sen;
  paidSen: Sen;
  remainingSen: Sen;
  pendingOrders: number;
  readyLines: number;
}

/** RPC get_tab_detail(p_tab_id). */
export interface TabDetailDTO {
  id: Uuid;
  tableId: Uuid;
  tableLabel: string;
  tableKind: TableKind;
  status: TabStatus;
  openedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
  pickupNo: number | null;
  pickupAt: IsoDateTime | null;
  orders: StaffOrderDTO[];
  payments: PaymentDTO[];
  /** Approved, not cancelled lines (combo line priced, components 0). */
  totalSen: Sen;
  /** Sum of payment amounts (exact, before cash rounding). */
  paidSen: Sen;
  remainingSen: Sen;
  /** Sum of cash rounding over payments. */
  roundingSen: number;
  hasPendingOrders: boolean;
  serverNow: IsoDateTime;
}

export interface StaffOrderDTO {
  id: Uuid;
  status: OrderStatus;
  createdAt: IsoDateTime;
  approvedAt: IsoDateTime | null;
  rejectedReason: string | null;
  lines: StaffLineDTO[];
}

export interface PaymentDTO {
  id: Uuid;
  method: PaidMethod;
  /** Exact amount this payment settles. */
  amountSen: Sen;
  /** Cash only: rounded-to-5-sen amount minus amountSen (-2..2). The customer handed over amountSen + roundingSen. */
  roundingSen: number;
  createdAt: IsoDateTime;
  /** Lines settled by an item split; empty otherwise. */
  orderItemIds: Uuid[];
}

/**
 * RPC record_payment. Omit both amountSen and orderItemIds to pay the full remaining balance
 * (Basic "Mark paid"). A smaller amountSen or orderItemIds is a split (Pro: bill_split).
 * The tab closes when payments reach its total.
 */
export interface RecordPaymentInput {
  tabId: Uuid;
  method: PaidMethod;
  amountSen?: Sen | null;
  orderItemIds?: Uuid[] | null;
}

export interface RecordPaymentResult {
  /** null when nothing was owed and the tab was just closed. */
  paymentId: Uuid | null;
  amountSen: Sen;
  roundingSen: number;
  remainingSen: Sen;
  tabClosed: boolean;
}

/** RPC get_sold_out_items(p_shop_id): active items for the sold-out switches. */
export interface SoldOutItemDTO {
  id: Uuid;
  categoryId: Uuid;
  categoryName: string;
  name: string;
  soldOut: boolean;
}

// ---------------------------------------------------------------------------------------------
// Owner (rows mirror tables; SupabaseData maps snake_case columns to these)
// ---------------------------------------------------------------------------------------------

export interface ShopSettings {
  id: Uuid;
  name: string;
  slug: string;
  logoUrl: string | null;
  planId: PlanId;
  approvalMode: ApprovalMode;
  nudgeCategoryId: Uuid | null;
  theme: ShopTheme;
  active: boolean;
  /** Pickup board token (Pro: takeaway); null until generated. */
  pickupBoardToken: string | null;
  createdAt: IsoDateTime;
}

export type ShopSettingsPatch = Partial<Pick<ShopSettings, 'name' | 'logoUrl' | 'approvalMode' | 'nudgeCategoryId' | 'theme'>>;

export interface StationRow {
  id: Uuid;
  shopId: Uuid;
  name: string;
  sort: number;
  active: boolean;
}

export interface CategoryRow {
  id: Uuid;
  shopId: Uuid;
  name: string;
  translations: Translations;
  sort: number;
  /** Availability window (used only when Pro: timed_menus is on). */
  window: TimeWindow | null;
}

export interface ItemRow {
  id: Uuid;
  shopId: Uuid;
  categoryId: Uuid;
  stationId: Uuid;
  name: string;
  description: string;
  translations: Translations;
  priceSen: Sen;
  photoUrl: string | null;
  photoState: PhotoState;
  active: boolean;
  soldOut: boolean;
  /** Set meal (Pro: combos); see ComboComponentRow. */
  isCombo: boolean;
  sort: number;
}

export interface ModifierGroupRow {
  id: Uuid;
  shopId: Uuid;
  itemId: Uuid;
  name: string;
  translations: Translations;
  minSelect: number;
  maxSelect: number;
  sort: number;
}

export interface ModifierOptionRow {
  id: Uuid;
  shopId: Uuid;
  groupId: Uuid;
  name: string;
  translations: Translations;
  /** >= 0 */
  priceDeltaSen: Sen;
  sort: number;
}

export interface PairingRow {
  sourceItemId: Uuid;
  suggestedItemId: Uuid;
  position: 1 | 2 | 3;
}

export interface ComboComponentRow {
  comboItemId: Uuid;
  itemId: Uuid;
  qty: number;
  sort: number;
}

/** Everything the menu editor shows, loaded in one call. */
export interface MenuEditorDTO {
  categories: CategoryRow[];
  items: ItemRow[];
  groups: ModifierGroupRow[];
  options: ModifierOptionRow[];
  pairings: PairingRow[];
  comboComponents: ComboComponentRow[];
  stations: StationRow[];
  nudgeCategoryId: Uuid | null;
}

/** Create when `id` is absent (appended: sort = max + 1), else update. */
export interface CategoryInput {
  id?: Uuid;
  shopId: Uuid;
  name: string;
  translations?: Translations;
  window?: TimeWindow | null;
}

export interface ItemInput {
  id?: Uuid;
  shopId: Uuid;
  categoryId: Uuid;
  /** Omitted or null: the shop's default (first active) station. */
  stationId?: Uuid | null;
  name: string;
  description?: string;
  translations?: Translations;
  priceSen: Sen;
  active?: boolean;
  soldOut?: boolean;
  /** Pro: combos (creating a combo item needs the feature). */
  isCombo?: boolean;
}

export interface ModifierGroupInput {
  id?: Uuid;
  shopId: Uuid;
  itemId: Uuid;
  name: string;
  translations?: Translations;
  minSelect: number;
  maxSelect: number;
}

export interface ModifierOptionInput {
  id?: Uuid;
  shopId: Uuid;
  groupId: Uuid;
  name: string;
  translations?: Translations;
  priceDeltaSen: Sen;
}

export type ReorderKind = 'categories' | 'items' | 'modifier_groups' | 'modifier_options' | 'stations' | 'tables';

export interface TableRow {
  id: Uuid;
  shopId: Uuid;
  label: string;
  kind: TableKind;
  /** QR token; the QR encodes `${SITE_BASE_URL}#/t/${token}`. */
  token: string;
  active: boolean;
  sort: number;
}

export interface TableInput {
  id?: Uuid;
  shopId: Uuid;
  label: string;
  /** Only on create; 'counter' needs Pro: takeaway. */
  kind?: TableKind;
  active?: boolean;
}

export interface StaffRow {
  id: Uuid;
  shopId: Uuid;
  name: string;
  active: boolean;
  createdAt: IsoDateTime;
}

export interface ItemSalesDTO {
  itemId: Uuid;
  name: string;
  qty: number;
  revenueSen: Sen;
}

/**
 * RPC get_daily_summary(p_shop_id, p_day). Sales = approved, not cancelled lines of orders
 * created that MYT day (combo lines priced, components 0); bills = distinct tabs among them;
 * averageBillSen = round half up of salesSen / bills (0 when no bills).
 */
export interface DailySummaryDTO {
  day: IsoDate;
  salesSen: Sen;
  orders: number;
  bills: number;
  averageBillSen: Sen;
  /** Top 5 by quantity, then revenue (items and combos, not components). */
  topItems: ItemSalesDTO[];
}

/** RPC get_shop_plan(p_shop_id): the owner's Plan page. */
export interface ShopPlanDTO {
  planId: PlanId;
  entitlements: Entitlements;
  /** Active rows counted against max_tables (tables, not counters), max_stations, max_staff. */
  usage: { tables: number; stations: number; staff: number };
  /** Platform setting for "Ask Teras" links; null = hide the link, show a neutral message. */
  askTerasWhatsapp: string | null;
}

// ---------------------------------------------------------------------------------------------
// Pro
// ---------------------------------------------------------------------------------------------

export interface StationInput {
  id?: Uuid;
  shopId: Uuid;
  name: string;
  active?: boolean;
}

export interface BoardColumnRow {
  id: Uuid;
  shopId: Uuid;
  stationId: Uuid;
  name: string;
  coreStatus: BoardStatus;
  sort: number;
}

/**
 * One column in set_board_columns (whole list, in order). Rules: every core status has at
 * least one column and core statuses never go backwards along the list.
 */
export interface BoardColumnInput {
  /** Keep an existing column (cards stay in it); omit for a new column. */
  id?: Uuid | null;
  name: string;
  coreStatus: BoardStatus;
}

export interface PromoRow {
  id: Uuid;
  shopId: Uuid;
  name: string;
  translations: Translations;
  discountType: DiscountType;
  /** percent: 1..100; amount: sen off the list price. */
  discountValue: number;
  days: IsoWeekday[];
  startTime: HHMM;
  endTime: HHMM;
  active: boolean;
  itemIds: Uuid[];
}

export type PromoInput = Omit<PromoRow, 'id'> & { id?: Uuid };

export interface ComboComponentInput {
  itemId: Uuid;
  /** 1..10 */
  qty: number;
}

/** RPC get_sales_report(p_shop_id, p_from, p_to) (Pro: full_reports). Same sales rules as DailySummaryDTO. */
export interface SalesReportDTO {
  from: IsoDate;
  to: IsoDate;
  salesSen: Sen;
  orders: number;
  bills: number;
  byDay: { day: IsoDate; salesSen: Sen; orders: number; bills: number }[];
  /** 24 entries, MYT hour 0..23, by order creation time. */
  byHour: { hour: number; salesSen: Sen; orders: number }[];
  /** Every active item (zero sellers included), revenue descending: best and worst sellers. */
  items: ItemSalesDTO[];
  /** Approval to ready, in minutes, per item with at least one ready line in range. */
  prep: { itemId: Uuid; name: string; count: number; avgMinutes: number; medianMinutes: number }[];
  prepOverall: { count: number; avgMinutes: number; medianMinutes: number };
}

/** RPC get_upsell_report(p_shop_id, p_month) (Pro: upsell_report). */
export interface UpsellReportDTO {
  /** 'YYYY-MM' */
  month: string;
  /** Revenue from lines added via a suggestion (approved, not cancelled). */
  revenueSen: Sen;
  adds: number;
  rows: {
    sourceItemId: Uuid;
    sourceName: string;
    suggestedItemId: Uuid;
    suggestedName: string;
    adds: number;
    revenueSen: Sen;
    /** Orders that month containing the source item (adds / sourceOrders = take-up rate). */
    sourceOrders: number;
  }[];
}

/** RPC export_shop_meta(p_shop_id) (Pro: export_backup). Settings and menu, no PIN hashes. */
export interface ShopExportMeta {
  version: 1;
  exportedAt: IsoDateTime;
  shop: ShopSettings;
  categories: CategoryRow[];
  items: ItemRow[];
  groups: ModifierGroupRow[];
  options: ModifierOptionRow[];
  pairings: PairingRow[];
  comboComponents: ComboComponentRow[];
  stations: StationRow[];
  boardColumns: BoardColumnRow[];
  promos: PromoRow[];
  tables: TableRow[];
  staff: StaffRow[];
}

/** RPC export_orders(p_shop_id, p_from, p_to) (Pro: export_backup). At most 93 days per call. */
export interface OrdersExportDTO {
  from: IsoDate;
  to: IsoDate;
  orders: (StaffOrderDTO & { tabId: Uuid; tableLabel: string; tableKind: TableKind; pickupNo: number | null })[];
  payments: (PaymentDTO & { tabId: Uuid; tableLabel: string })[];
}

/**
 * Seam for backup destinations. The destination is an open owner decision; v1 ships only
 * "download to this device" (lib/backup.ts). A future target (for example the shop owner's
 * own cloud drive) implements this interface; nothing else changes.
 */
export interface BackupFile {
  name: string;
  mime: string;
  data: Blob;
}

export interface BackupTarget {
  readonly id: string;
  readonly label: string;
  /** false hides the target. */
  isAvailable(): boolean;
  save(file: BackupFile): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Teras admin
// ---------------------------------------------------------------------------------------------

export interface OverrideDTO {
  key: EntitlementKey;
  /** Feature keys: the forced value. null for limit keys. */
  enabled: boolean | null;
  /** Limit keys: the forced limit (null = unlimited). null for feature keys. */
  limitValue: number | null;
  note: string;
  changedByEmail: string | null;
  changedAt: IsoDateTime;
}

/** RPC admin_list_shops(). */
export interface AdminShopDTO {
  id: Uuid;
  name: string;
  slug: string;
  planId: PlanId;
  active: boolean;
  createdAt: IsoDateTime;
  lastOrderAt: IsoDateTime | null;
  ownerEmails: string[];
  overrides: OverrideDTO[];
  entitlements: Entitlements;
}

export interface CreateShopInput {
  name: string;
  /** Shop code staff type at sign-in: ^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$ */
  slug: string;
}

export interface OverrideInput {
  shopId: Uuid;
  key: EntitlementKey;
  /** Required for feature keys. */
  enabled?: boolean;
  /** For limit keys; null = unlimited. */
  limitValue?: number | null;
  /** Required, e.g. "Bill split add-on". */
  note: string;
}

export type OwnerLinkMode = 'invite' | 'reset';

/** Edge Function admin-owner-link result, turned into a shareable one-time sign-in link. */
export interface OwnerLinkDTO {
  email: string;
  mode: OwnerLinkMode;
  /** `${SITE_BASE_URL}#/welcome?token_hash=...&type=email|recovery` */
  url: string;
  /** Link lifetime from the Auth email OTP expiry setting. */
  expiresHours: number;
}

export interface PlatformSettingsDTO {
  /** Digits only, international format without '+', e.g. '60123456789'. */
  whatsappNumber: string | null;
}

// ---------------------------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------------------------

/** Tables in the Realtime publication. */
export type ShopTable = 'orders' | 'order_items' | 'service_requests' | 'tabs';

/** A row changed. Screens reload their data (debounced); payloads are not merged. */
export interface ShopChange {
  table: ShopTable;
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  id: Uuid;
}

/** 'live' after 'offline' means events may have been missed: reload everything. */
export type ConnectionState = 'connecting' | 'live' | 'offline';

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------------------------

/** Anon customer calls, keyed by the table token in the QR. SupabaseData uses plain fetch here. */
export interface CustomerApi {
  /** RPC get_menu -> MenuDTO. Errors: not_found. */
  getMenu(tableToken: string): Promise<MenuDTO>;
  /**
   * RPC place_order -> PlaceOrderResult. Errors: not_found, shop_inactive, invalid_input,
   * item_unavailable, sold_out, rate_limited, feature_not_enabled.
   */
  placeOrder(tableToken: string, input: PlaceOrderInput): Promise<PlaceOrderResult>;
  /** RPC get_tab -> CustomerTabDTO. `tabId` is required for counter tokens (the phone keeps its own). */
  getTab(tableToken: string, tabId?: Uuid | null): Promise<CustomerTabDTO>;
  /** RPC call_server. Repeat taps merge into the open request. Note <= 140 characters. */
  callServer(tableToken: string, reason: ServiceReason, note?: string | null): Promise<void>;
  /** RPC get_pickup_board -> PickupBoardDTO (Pro: takeaway). */
  getPickupBoard(boardToken: string): Promise<PickupBoardDTO>;
}

export interface AuthApi {
  getUser(): Promise<AuthUser | null>;
  /** Owners and Teras admins. Replaces any anonymous staff-device session on this browser. */
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** One-time link from the admin screen (`#/welcome?token_hash=...&type=...`). Signs the owner in. */
  verifyLink(tokenHash: string, type: OwnerLinkType): Promise<void>;
  /** After verifyLink: owner sets or resets their password (min 8 characters). */
  setPassword(password: string): Promise<void>;
  /** RPC my_staff_session; null when this device has no live staff session. */
  getStaffSession(): Promise<StaffSession | null>;
  /**
   * Signs the device in anonymously if needed, then RPC claim_staff_session.
   * `staffCode` is the shop's secret code (any case, dashes and spaces ignored), never the public slug.
   * Errors: not_found (unknown staff code), invalid_pin, pin_locked, feature_not_enabled.
   */
  claimStaffSession(staffCode: string, pin: string): Promise<StaffSession>;
  /** RPC end_staff_session. Keeps the anonymous device user. */
  endStaffSession(): Promise<void>;
  /** RPC my_shops. */
  myShops(): Promise<OwnerShopDTO[]>;
  /** RPC is_platform_admin. */
  isPlatformAdmin(): Promise<boolean>;
}

/** Staff (live PIN session) or owner of the shop. */
export interface StaffApi {
  /** RPC get_pending_orders. */
  listPendingOrders(shopId: Uuid): Promise<PendingOrderDTO[]>;
  /** RPC approve_order. Errors: invalid_transition (not pending). */
  approveOrder(orderId: Uuid): Promise<void>;
  /** RPC reject_order. Reason 1..140 characters. */
  rejectOrder(orderId: Uuid, reason: string): Promise<void>;
  /** RPC get_service_requests. */
  listServiceRequests(shopId: Uuid): Promise<ServiceRequestDTO[]>;
  /** RPC acknowledge_request. */
  acknowledgeRequest(requestId: Uuid): Promise<void>;
  /** RPC complete_request. */
  completeRequest(requestId: Uuid): Promise<void>;
  /** RPC get_stations: active stations, sorted (Basic: one). */
  listStations(shopId: Uuid): Promise<StationRow[]>;
  /** RPC get_board. `stationId` null = the default (first active) station. */
  getBoard(shopId: Uuid, stationId: Uuid | null): Promise<BoardDTO>;
  /**
   * RPC advance_item. Valid core moves only (see DATA-MODEL advance_item); `columnId` moves a
   * card between custom columns (Pro: custom_columns). Errors: invalid_transition, invalid_input.
   */
  advanceItem(orderItemId: Uuid, to: ItemStatus, columnId?: Uuid | null): Promise<void>;
  /** RPC get_ready_lines: the "To serve" strip, all stations. */
  listReadyLines(shopId: Uuid): Promise<BoardLineDTO[]>;
  /** RPC get_tables_overview. */
  listTables(shopId: Uuid): Promise<TableOverviewDTO[]>;
  /** RPC get_tab_detail. */
  getTabDetail(tabId: Uuid): Promise<TabDetailDTO>;
  /** RPC record_payment. Errors: tab_closed, pending_orders, invalid_input, feature_not_enabled. */
  recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult>;
  /** RPC get_sold_out_items. */
  listSoldOutItems(shopId: Uuid): Promise<SoldOutItemDTO[]>;
  /** RPC set_item_sold_out. */
  setSoldOut(itemId: Uuid, soldOut: boolean): Promise<void>;
}

/** Owner of the shop (Basic screens). */
export interface OwnerApi {
  getShopSettings(shopId: Uuid): Promise<ShopSettings>;
  updateShopSettings(shopId: Uuid, patch: ShopSettingsPatch): Promise<void>;
  /** Resizes in the browser, uploads to Storage `menu-staging/{shopId}/logo/{uuid}.webp`, returns the URL. */
  uploadLogo(shopId: Uuid, file: Blob): Promise<string>;
  getMenuEditor(shopId: Uuid): Promise<MenuEditorDTO>;
  saveCategory(input: CategoryInput): Promise<CategoryRow>;
  /** Errors: in_use when the category still has items. */
  deleteCategory(categoryId: Uuid): Promise<void>;
  saveItem(input: ItemInput): Promise<ItemRow>;
  /**
   * Resizes to <= 1200 px WebP 0.8 (JPEG fallback), uploads to
   * `menu-staging/{shopId}/{itemId}/{uuid}.webp`, sets photo_url and photo_state = 'staging'.
   */
  uploadItemPhoto(shopId: Uuid, itemId: Uuid, file: Blob): Promise<ItemRow>;
  saveModifierGroup(input: ModifierGroupInput): Promise<ModifierGroupRow>;
  deleteModifierGroup(groupId: Uuid): Promise<void>;
  saveModifierOption(input: ModifierOptionInput): Promise<ModifierOptionRow>;
  deleteModifierOption(optionId: Uuid): Promise<void>;
  /** Sets sort = index for the given ids (all must belong to one shop). */
  reorder(kind: ReorderKind, orderedIds: Uuid[]): Promise<void>;
  /** RPC set_item_pairings: up to 3 suggested items, in order. */
  setPairings(itemId: Uuid, suggestedItemIds: Uuid[]): Promise<void>;
  listTables(shopId: Uuid): Promise<TableRow[]>;
  /** Errors: limit_reached (max_tables), feature_not_enabled (counter without takeaway). */
  saveTable(input: TableInput): Promise<TableRow>;
  /** RPC regenerate_table_token: the old QR stops working. */
  regenerateTableToken(tableId: Uuid): Promise<TableRow>;
  listStaff(shopId: Uuid): Promise<StaffRow[]>;
  /** RPC add_staff. PIN 4..6 digits. Errors: limit_reached, duplicate_pin, invalid_input. */
  addStaff(shopId: Uuid, name: string, pin: string): Promise<StaffRow>;
  /** RPC update_staff. Reactivating can hit limit_reached. */
  updateStaff(staffId: Uuid, patch: { name?: string; active?: boolean }): Promise<void>;
  /** RPC set_staff_pin. Errors: duplicate_pin, invalid_input. */
  resetStaffPin(staffId: Uuid, pin: string): Promise<void>;
  /** RPC get_staff_code: the shop's secret staff code, 8 characters (format with `formatStaffCode`). Owners only. */
  getStaffCode(shopId: Uuid): Promise<string>;
  /** RPC regenerate_staff_code: returns the new code; every staff session of the shop ends. */
  regenerateStaffCode(shopId: Uuid): Promise<string>;
  /** RPC get_daily_summary. Errors: outside_report_window. */
  getDailySummary(shopId: Uuid, day: IsoDate): Promise<DailySummaryDTO>;
  /** RPC get_shop_plan. */
  getShopPlan(shopId: Uuid): Promise<ShopPlanDTO>;
}

/** Pro owner screens. Each method's server check is noted; the UI also gates with useFeature. */
export interface ProApi {
  /** multi_station via max_stations (limit_reached). */
  saveStation(input: StationInput): Promise<StationRow>;
  getBoardColumns(stationId: Uuid): Promise<BoardColumnRow[]>;
  /** RPC set_board_columns (custom_columns). Replaces the station's list. */
  setBoardColumns(stationId: Uuid, columns: BoardColumnInput[]): Promise<BoardColumnRow[]>;
  listPromos(shopId: Uuid): Promise<PromoRow[]>;
  /** RPC save_promo (promos). */
  savePromo(input: PromoInput): Promise<PromoRow>;
  deletePromo(promoId: Uuid): Promise<void>;
  /** RPC set_combo_components (combos). Replaces the list; items only, no nested combos. */
  setComboComponents(comboItemId: Uuid, components: ComboComponentInput[]): Promise<void>;
  /** RPC regenerate_pickup_board_token (takeaway). Returns the new token. */
  regeneratePickupBoardToken(shopId: Uuid): Promise<string>;
  /** RPC get_sales_report (full_reports). Range <= 366 days. */
  getSalesReport(shopId: Uuid, from: IsoDate, to: IsoDate): Promise<SalesReportDTO>;
  /** RPC get_upsell_report (upsell_report). `month` is 'YYYY-MM'. */
  getUpsellReport(shopId: Uuid, month: string): Promise<UpsellReportDTO>;
  /** RPC export_shop_meta (export_backup). */
  exportShopMeta(shopId: Uuid): Promise<ShopExportMeta>;
  /** RPC export_orders (export_backup). Range <= 93 days; callers page through longer spans. */
  exportOrders(shopId: Uuid, from: IsoDate, to: IsoDate): Promise<OrdersExportDTO>;
}

/** Teras platform admins only. */
export interface AdminApi {
  listShops(): Promise<AdminShopDTO[]>;
  /** RPC admin_create_shop: Basic plan, one "Kitchen" station, a "Drinks" nudge category. Returns the id. */
  createShop(input: CreateShopInput): Promise<Uuid>;
  /** Edge Function admin-owner-link. 'invite' creates the user if needed and makes them an owner. */
  createOwnerLink(shopId: Uuid, email: string, mode: OwnerLinkMode): Promise<OwnerLinkDTO>;
  setPlan(shopId: Uuid, planId: PlanId): Promise<void>;
  setOverride(input: OverrideInput): Promise<void>;
  clearOverride(shopId: Uuid, key: EntitlementKey): Promise<void>;
  /** Inactive shops show "Not taking orders" to customers. */
  setShopActive(shopId: Uuid, active: boolean): Promise<void>;
  getPlatformSettings(): Promise<PlatformSettingsDTO>;
  setPlatformSettings(settings: PlatformSettingsDTO): Promise<void>;
}

export interface LaparData {
  readonly kind: 'demo' | 'supabase';
  readonly customer: CustomerApi;
  readonly auth: AuthApi;
  readonly staff: StaffApi;
  readonly owner: OwnerApi;
  readonly pro: ProApi;
  readonly admin: AdminApi;
  /**
   * RPC get_entitlements: plan values replaced by overrides. Loaded once per session by the
   * route wrapper; members and admins only (forbidden otherwise).
   */
  getEntitlements(shopId: Uuid): Promise<Entitlements>;
  /**
   * Live changes to the shop's orders, lines, server calls and tabs (Realtime, filtered by
   * shop_id; RLS applies). `onState` reports the connection so screens reload on reconnect.
   */
  subscribeShop(
    shopId: Uuid,
    onChange: (change: ShopChange) => void,
    onState?: (state: ConnectionState) => void,
  ): Unsubscribe;
}

// ---------------------------------------------------------------------------------------------
// Demo only (implemented by DemoData; never by SupabaseData)
// ---------------------------------------------------------------------------------------------

/** Clock presets so a pitch can show timed menus and happy hour at any real time. */
export type DemoClock = 'real' | 'breakfast' | 'lunch' | 'afternoon';

export interface DemoControls {
  readonly shopId: Uuid;
  /** Demo QR tokens: Table 1..10, then the counter. */
  readonly tables: readonly { token: string; label: string; kind: TableKind }[];
  readonly pickupBoardToken: string;
  getPlan(): PlanId;
  /** Flips the demo shop's entitlements; data is kept (a downgrade hides, never deletes). */
  setPlan(plan: PlanId): void;
  getClock(): DemoClock;
  setClock(clock: DemoClock): void;
  /** Restores the seed and clears saved state. */
  reset(): void;
  /** Any demo change (data, plan, clock). The shell uses it for toasts and re-render. */
  onChange(listener: () => void): Unsubscribe;
}

/** What `createDemoData()` (app/src/data/demo/index.ts) returns. */
export type LaparDemoData = LaparData & DemoControls;
