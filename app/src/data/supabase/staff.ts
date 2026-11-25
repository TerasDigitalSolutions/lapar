import type {
  BoardDTO,
  BoardLineDTO,
  PendingOrderDTO,
  RecordPaymentResult,
  ServiceRequestDTO,
  SoldOutItemDTO,
  StaffApi,
  StationRow,
  TabDetailDTO,
  TableOverviewDTO,
} from '../types';
import { rpc } from './authed';

// Results are camelCase JSON already: pass through.
export const staffApi: StaffApi = {
  listPendingOrders: (shopId) => rpc<PendingOrderDTO[]>('get_pending_orders', { p_shop_id: shopId }),
  approveOrder: (orderId) => rpc('approve_order', { p_order_id: orderId }),
  rejectOrder: (orderId, reason) => rpc('reject_order', { p_order_id: orderId, p_reason: reason }),
  listServiceRequests: (shopId) => rpc<ServiceRequestDTO[]>('get_service_requests', { p_shop_id: shopId }),
  acknowledgeRequest: (requestId) => rpc('acknowledge_request', { p_request_id: requestId }),
  completeRequest: (requestId) => rpc('complete_request', { p_request_id: requestId }),
  listStations: (shopId) => rpc<StationRow[]>('get_stations', { p_shop_id: shopId }),
  getBoard: (shopId, stationId) => rpc<BoardDTO>('get_board', { p_shop_id: shopId, p_station_id: stationId }),
  advanceItem: (orderItemId, to, columnId) =>
    rpc('advance_item', { p_item_id: orderItemId, p_to: to, p_column_id: columnId ?? null }),
  listReadyLines: (shopId) => rpc<BoardLineDTO[]>('get_ready_lines', { p_shop_id: shopId }),
  listTables: (shopId) => rpc<TableOverviewDTO[]>('get_tables_overview', { p_shop_id: shopId }),
  getTabDetail: (tabId) => rpc<TabDetailDTO>('get_tab_detail', { p_tab_id: tabId }),
  recordPayment: (input) =>
    rpc<RecordPaymentResult>('record_payment', {
      p_tab_id: input.tabId,
      p_method: input.method,
      p_amount_sen: input.amountSen ?? null,
      p_order_item_ids: input.orderItemIds ?? null,
    }),
  listSoldOutItems: (shopId) => rpc<SoldOutItemDTO[]>('get_sold_out_items', { p_shop_id: shopId }),
  setSoldOut: (itemId, soldOut) => rpc('set_item_sold_out', { p_item_id: itemId, p_sold_out: soldOut }),
};
