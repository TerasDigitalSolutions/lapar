/**
 * DemoState: one array per database table (camelCase rows mirroring the columns of
 * docs/DATA-MODEL.md section 3, Pro tables included), plus the demo's plan and clock.
 */
import type {
  BoardColumnRow,
  CategoryRow,
  ComboComponentRow,
  DemoClock,
  IsoDateTime,
  ItemRow,
  ItemStatus,
  LineKind,
  LineOption,
  ModifierGroupRow,
  ModifierOptionRow,
  OrderStatus,
  PaidMethod,
  PairingRow,
  PlanId,
  PromoRow,
  ServiceReason,
  ServiceStatus,
  ShopSettings,
  StaffRow,
  StationRow,
  TabStatus,
  TableKind,
  TableRow,
  Uuid,
} from '../types';

export const STORAGE_KEY = 'lapar-demo-v1';
export const STATE_VERSION = 2;
/** Generated history rows carry this id prefix; they are never persisted. */
export const HISTORY_PREFIX = 'hist-';

export interface TabRow {
  id: Uuid;
  tableId: Uuid;
  kind: TableKind;
  status: TabStatus;
  openedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
  pickupNo: number | null;
  pickupAt: IsoDateTime | null;
  paidTotalSen: number | null;
  roundingSen: number | null;
  updatedAt: IsoDateTime;
}

export interface OrderRow {
  id: Uuid;
  tabId: Uuid;
  status: OrderStatus;
  createdAt: IsoDateTime;
  approvedAt: IsoDateTime | null;
  approvedByStaffId: Uuid | null;
  rejectedReason: string | null;
}

export interface OrderItemRow {
  id: Uuid;
  orderId: Uuid;
  lineNo: number;
  kind: LineKind;
  parentLineId: Uuid | null;
  itemId: Uuid;
  nameSnapshot: string;
  listPriceSen: number;
  unitPriceSen: number;
  promoId: Uuid | null;
  qty: number;
  options: LineOption[];
  optionsPriceSen: number;
  /** qty * (unitPriceSen + optionsPriceSen), stored like the generated column. */
  lineTotalSen: number;
  note: string | null;
  stationId: Uuid;
  status: ItemStatus;
  statusChangedAt: IsoDateTime;
  columnId: Uuid | null;
  readyAt: IsoDateTime | null;
  servedAt: IsoDateTime | null;
  suggestedFromItemId: Uuid | null;
  paidPaymentId: Uuid | null;
  createdAt: IsoDateTime;
}

export interface ServiceRequestRow {
  id: Uuid;
  tableId: Uuid;
  tabId: Uuid | null;
  reason: ServiceReason;
  note: string | null;
  status: ServiceStatus;
  tapCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  acknowledgedAt: IsoDateTime | null;
  doneAt: IsoDateTime | null;
}

export interface PaymentRow {
  id: Uuid;
  tabId: Uuid;
  method: PaidMethod;
  amountSen: number;
  roundingSen: number;
  createdAt: IsoDateTime;
  createdByStaffId: Uuid | null;
}

export interface AutoPairingRow extends PairingRow {
  support: number;
  confidence: number;
}

export interface DemoState {
  version: typeof STATE_VERSION;
  plan: PlanId;
  clock: DemoClock;
  /** Counter for readable generated ids. */
  seq: number;
  shop: ShopSettings;
  stations: StationRow[];
  categories: CategoryRow[];
  items: ItemRow[];
  groups: ModifierGroupRow[];
  options: ModifierOptionRow[];
  pairings: PairingRow[];
  autoPairings: AutoPairingRow[];
  comboComponents: ComboComponentRow[];
  promos: PromoRow[];
  boardColumns: BoardColumnRow[];
  tables: TableRow[];
  staff: StaffRow[];
  /** Demo PINs are kept in the clear (seed PINs are public demo values). */
  staffPins: { staffId: Uuid; pin: string }[];
  /** The staff member the demo device is signed in as (null: an owner acts). */
  actorStaffId: Uuid | null;
  /** The shop's secret staff code (8 characters, no dashes). */
  staffCode: string;
  pinAttempts: { failures: number; lockedUntil: IsoDateTime | null };
  pickupCounters: { day: string; lastNo: number }[];
  tabs: TabRow[];
  orders: OrderRow[];
  orderItems: OrderItemRow[];
  requests: ServiceRequestRow[];
  payments: PaymentRow[];
}

/** Rows made by history.ts; merged into the working state at load and never saved. */
export type HistoryRows = Pick<DemoState, 'tabs' | 'orders' | 'orderItems' | 'payments'>;

export const isHistoryId = (id: string): boolean => id.startsWith(HISTORY_PREFIX);

/** The state without generated history, safe to persist. */
export function withoutHistory(s: DemoState): DemoState {
  return {
    ...s,
    tabs: s.tabs.filter((r) => !isHistoryId(r.id)),
    orders: s.orders.filter((r) => !isHistoryId(r.id)),
    orderItems: s.orderItems.filter((r) => !isHistoryId(r.id)),
    payments: s.payments.filter((r) => !isHistoryId(r.id)),
  };
}

/** Loose shape check for saved state; anything else falls back to the seed. */
export function isDemoState(v: unknown): v is DemoState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<DemoState>;
  return (
    s.version === STATE_VERSION &&
    (s.plan === 'basic' || s.plan === 'pro') &&
    !!s.shop &&
    [s.items, s.tables, s.staff, s.tabs, s.orders, s.orderItems, s.requests, s.payments, s.categories, s.groups, s.options].every(
      Array.isArray,
    )
  );
}
