import type { CustomerApi, CustomerTabDTO, MenuDTO, PickupBoardDTO, PlaceOrderResult } from '../types';
import { rpcAnon } from './rest';

export const customerApi: CustomerApi = {
  getMenu: (tableToken) => rpcAnon<MenuDTO>('get_menu', { p_table_token: tableToken }),
  placeOrder: (tableToken, input) =>
    rpcAnon<PlaceOrderResult>('place_order', {
      p_table_token: tableToken,
      p_lines: input.lines,
      p_pickup_at: input.pickupAt ?? null,
    }),
  getTab: (tableToken, tabId) => rpcAnon<CustomerTabDTO>('get_tab', { p_table_token: tableToken, p_tab_id: tabId ?? null }),
  async callServer(tableToken, reason, note) {
    await rpcAnon('call_server', { p_table_token: tableToken, p_reason: reason, p_note: note ?? null });
  },
  getPickupBoard: (boardToken) => rpcAnon<PickupBoardDTO>('get_pickup_board', { p_board_token: boardToken }),
};
