import type {
  DailySummaryDTO,
  MenuEditorDTO,
  OwnerApi,
  ReorderKind,
  ShopPlanDTO,
  ShopSettingsPatch,
  Uuid,
} from '../types';
import { run, rpc, type Client } from './authed';
import { categoryRow, groupRow, itemRow, optionRow, shopSettings, staffRow, tableRow, windowColumns } from './rows';
import { uploadImage } from './upload';

type Raw = Record<string, unknown>;

/** Next `sort` for a new row: max + 1 within the filter (RLS already limits to the owner's shop). */
async function nextSort(c: Client, table: string, filter: Record<string, unknown>): Promise<number> {
  const { data, error } = await c.from(table).select('sort').match(filter).order('sort', { ascending: false }).limit(1);
  if (error) throw error;
  return ((data?.[0] as { sort?: number } | undefined)?.sort ?? -1) + 1;
}

const defined = (o: Raw): Raw => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Insert (no id) or update (id) one row and return it. */
const save = (table: string, id: Uuid | undefined, insert: (c: Client) => Promise<Raw>, patch: Raw) =>
  run<Raw>(async (c) => {
    try {
      const q = id ? c.from(table).update(defined(patch)).eq('id', id) : c.from(table).insert(await insert(c));
      return await q.select().single();
    } catch (error) {
      return { data: null, error };
    }
  });

const REORDER_TABLES: Record<ReorderKind, string> = {
  categories: 'categories',
  items: 'items',
  modifier_groups: 'modifier_groups',
  modifier_options: 'modifier_options',
  stations: 'stations',
  tables: 'tables',
};

export const ownerApi: OwnerApi = {
  async getShopSettings(shopId) {
    return shopSettings(await run<Raw>((c) => c.from('shops').select('*').eq('id', shopId).single()));
  },

  async updateShopSettings(shopId, patch: ShopSettingsPatch) {
    const columns = defined({
      name: patch.name,
      logo_url: patch.logoUrl,
      approval_mode: patch.approvalMode,
      nudge_category_id: patch.nudgeCategoryId,
    });
    if (Object.keys(columns).length) await run((c) => c.from('shops').update(columns).eq('id', shopId));
  },

  uploadLogo: (shopId, file) => uploadImage(`${shopId}/logo`, file),

  getMenuEditor: (shopId) => rpc<MenuEditorDTO>('get_menu_editor', { p_shop_id: shopId }),

  async saveCategory(input) {
    const row = await save(
      'categories',
      input.id,
      async (c) => ({
        shop_id: input.shopId,
        name: input.name,
        translations: input.translations ?? {},
        sort: await nextSort(c, 'categories', { shop_id: input.shopId }),
        ...windowColumns(input.window ?? null),
      }),
      {
        name: input.name,
        translations: input.translations,
        ...(input.window === undefined ? {} : windowColumns(input.window)),
      },
    );
    return categoryRow(row);
  },

  async deleteCategory(categoryId) {
    await run((c) => c.from('categories').delete().eq('id', categoryId)); // FK 23503 -> in_use
  },

  async saveItem(input) {
    const row = await save(
      'items',
      input.id,
      async (c) => {
        const station =
          input.stationId ??
          (await c.from('stations').select('id').eq('shop_id', input.shopId).eq('active', true).order('sort').limit(1)).data?.[0]?.id;
        return {
          shop_id: input.shopId,
          category_id: input.categoryId,
          station_id: station,
          name: input.name,
          description: input.description ?? '',
          translations: input.translations ?? {},
          price_sen: input.priceSen,
          active: input.active ?? true,
          sold_out: input.soldOut ?? false,
          is_combo: input.isCombo ?? false,
          sort: await nextSort(c, 'items', { shop_id: input.shopId, category_id: input.categoryId }),
        };
      },
      {
        category_id: input.categoryId,
        station_id: input.stationId ?? undefined,
        name: input.name,
        description: input.description,
        translations: input.translations,
        price_sen: input.priceSen,
        active: input.active,
        sold_out: input.soldOut,
        is_combo: input.isCombo,
      },
    );
    return itemRow(row);
  },

  async uploadItemPhoto(shopId, itemId, file) {
    const url = await uploadImage(`${shopId}/${itemId}`, file);
    const row = await run<Raw>((c) =>
      c.from('items').update({ photo_url: url, photo_state: 'staging' }).eq('id', itemId).select().single(),
    );
    return itemRow(row);
  },

  async saveModifierGroup(input) {
    const row = await save(
      'modifier_groups',
      input.id,
      async (c) => ({
        shop_id: input.shopId,
        item_id: input.itemId,
        name: input.name,
        translations: input.translations ?? {},
        min_select: input.minSelect,
        max_select: input.maxSelect,
        sort: await nextSort(c, 'modifier_groups', { item_id: input.itemId }),
      }),
      { name: input.name, translations: input.translations, min_select: input.minSelect, max_select: input.maxSelect },
    );
    return groupRow(row);
  },

  async deleteModifierGroup(groupId) {
    await run((c) => c.from('modifier_groups').delete().eq('id', groupId));
  },

  async saveModifierOption(input) {
    const row = await save(
      'modifier_options',
      input.id,
      async (c) => ({
        shop_id: input.shopId,
        group_id: input.groupId,
        name: input.name,
        translations: input.translations ?? {},
        price_delta_sen: input.priceDeltaSen,
        sort: await nextSort(c, 'modifier_options', { group_id: input.groupId }),
      }),
      { name: input.name, translations: input.translations, price_delta_sen: input.priceDeltaSen },
    );
    return optionRow(row);
  },

  async deleteModifierOption(optionId) {
    await run((c) => c.from('modifier_options').delete().eq('id', optionId));
  },

  async reorder(kind, orderedIds) {
    // shortcut: one update per row (small lists); an RPC would make it atomic
    await Promise.all(
      orderedIds.map((id, sort) => run((c) => c.from(REORDER_TABLES[kind]).update({ sort }).eq('id', id))),
    );
  },

  async setPairings(itemId, suggestedItemIds) {
    await rpc('set_item_pairings', { p_item_id: itemId, p_suggested: suggestedItemIds });
  },

  async listTables(shopId) {
    const rows = await run<Raw[]>((c) => c.from('tables').select('*').eq('shop_id', shopId).order('sort').order('label'));
    return rows.map(tableRow);
  },

  async saveTable(input) {
    // The token is generated by the column default; the client never sends it.
    const row = await save(
      'tables',
      input.id,
      async (c) => ({
        shop_id: input.shopId,
        label: input.label,
        kind: input.kind ?? 'table',
        active: input.active ?? true,
        sort: await nextSort(c, 'tables', { shop_id: input.shopId }),
      }),
      { label: input.label, active: input.active },
    );
    return tableRow(row);
  },

  async regenerateTableToken(tableId) {
    return tableRow(await rpc<Raw>('regenerate_table_token', { p_table_id: tableId }));
  },

  async listStaff(shopId) {
    const rows = await run<Raw[]>((c) => c.from('staff').select('*').eq('shop_id', shopId).order('created_at'));
    return rows.map(staffRow);
  },

  async addStaff(shopId, name, pin) {
    return staffRow(await rpc<Raw>('add_staff', { p_shop_id: shopId, p_name: name, p_pin: pin }));
  },

  async updateStaff(staffId, patch) {
    await rpc('update_staff', { p_staff_id: staffId, p_name: patch.name ?? null, p_active: patch.active ?? null });
  },

  async resetStaffPin(staffId, pin) {
    await rpc('set_staff_pin', { p_staff_id: staffId, p_pin: pin });
  },

  getStaffCode: (shopId) => rpc<string>('get_staff_code', { p_shop_id: shopId }),
  regenerateStaffCode: (shopId) => rpc<string>('regenerate_staff_code', { p_shop_id: shopId }),

  getDailySummary: (shopId, day) => rpc<DailySummaryDTO>('get_daily_summary', { p_shop_id: shopId, p_day: day }),
  getShopPlan: (shopId) => rpc<ShopPlanDTO>('get_shop_plan', { p_shop_id: shopId }),
};
