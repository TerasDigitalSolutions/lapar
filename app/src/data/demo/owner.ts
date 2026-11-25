/** Owner API (DATA-MODEL 6.4 and the owner's table policies), Basic rules. */
import type {
  CategoryRow,
  ItemRow,
  ModifierGroupRow,
  ModifierOptionRow,
  OwnerApi,
  ReorderKind,
  ShopSettingsPatch,
  StaffRow,
  TableRow,
  TimeWindow,
  Translations,
} from '../types';
import { resizeImage } from '../../lib/image';
import { getDailySummary } from './reports';
import {
  assertShop,
  assertWithinLimit,

  blobToDataUrl,
  bySort,
  defaultStation,
  entitlements,
  fail,
  gate,
  nowIso,
  text,
  type Ctx,
} from './util';

/** Shrinks to 400 px WebP; keeps the original when the browser cannot decode it (e.g. jsdom). */
async function resizedDataUrl(file: Blob): Promise<string> {
  try {
    return await blobToDataUrl(await resizeImage(file, 400, 0.7));
  } catch {
    return blobToDataUrl(file);
  }
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const PIN = /^[0-9]{4,6}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const APPROVAL = ['every_order', 'first_order', 'none'];

function checkWindow(w: TimeWindow | null | undefined): TimeWindow | null {
  if (!w) return null;
  if (!HHMM.test(w.from) || !HHMM.test(w.to) || w.from === w.to) fail('invalid_input', 'window');
  if (w.days && (!w.days.length || w.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) fail('invalid_input', 'window');
  return copy(w);
}

function checkPrice(value: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > max) fail('invalid_input', field);
  return value;
}

export function createOwnerApi(ctx: Ctx): OwnerApi {
  const s = () => ctx.s;
  const nextSort = (rows: { sort: number }[]) => rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
  const saved = <T>(row: T): T => {
    ctx.emit();
    return copy(row);
  };

  /** PIN must be unique among a shop's active staff (DECISIONS D10). */
  const assertPinFree = (pin: string, exceptStaffId: string | null) => {
    const active = new Set(s().staff.filter((m) => m.active && m.id !== exceptStaffId).map((m) => m.id));
    if (s().staffPins.some((p) => active.has(p.staffId) && p.pin === pin)) fail('duplicate_pin');
  };
  const activeCount = (list: { active: boolean }[], except?: unknown) => list.filter((r) => r.active && r !== except).length;
  const activeTables = (except?: unknown) => s().tables.filter((t) => t.kind === 'table' && t.active && t !== except).length;
  const assertLabelFree = (label: string, except?: TableRow) => {
    if (s().tables.some((t) => t !== except && t.active && t.label.toLowerCase() === label.toLowerCase())) fail('invalid_input', 'label');
  };

  return {
    async getShopSettings(shopId) {
      assertShop(ctx, shopId);
      return copy(s().shop);
    },

    async updateShopSettings(shopId, patch: ShopSettingsPatch) {
      assertShop(ctx, shopId);
      const shop = s().shop;
      const next = { ...shop };
      if (patch.name !== undefined) next.name = text(patch.name, 80, 'name');
      if (patch.logoUrl !== undefined) next.logoUrl = patch.logoUrl;
      if (patch.approvalMode !== undefined) {
        if (!APPROVAL.includes(patch.approvalMode)) fail('invalid_input', 'approval_mode');
        next.approvalMode = patch.approvalMode;
      }
      if (patch.nudgeCategoryId !== undefined) {
        if (patch.nudgeCategoryId !== null && !s().categories.some((c) => c.id === patch.nudgeCategoryId)) fail('invalid_input', 'nudge_category_id');
        next.nudgeCategoryId = patch.nudgeCategoryId;
      }
      Object.assign(shop, next);
      ctx.emit();
    },

    async uploadLogo(shopId, file) {
      assertShop(ctx, shopId);
      return resizedDataUrl(file);
    },

    async getMenuEditor(shopId) {
      assertShop(ctx, shopId);
      const st = s();
      return copy({
        categories: [...st.categories].sort(bySort),
        items: [...st.items].sort(bySort),
        groups: [...st.groups].sort(bySort),
        options: [...st.options].sort(bySort),
        pairings: st.pairings,
        comboComponents: st.comboComponents,
        stations: [...st.stations].sort(bySort),
        nudgeCategoryId: st.shop.nudgeCategoryId,
      });
    },

    async saveCategory(input) {
      assertShop(ctx, input.shopId);
      const name = text(input.name, 40, 'name');
      const window = input.window === undefined ? undefined : checkWindow(input.window);
      const translations: Translations | undefined = input.translations && copy(input.translations);
      let row: CategoryRow | undefined;
      if (input.id) {
        row = s().categories.find((c) => c.id === input.id) ?? fail('not_found');
        row.name = name;
        if (translations) row.translations = translations;
        if (window !== undefined) row.window = window;
      } else {
        row = { id: ctx.id('cat'), shopId: input.shopId, name, translations: translations ?? {}, sort: nextSort(s().categories), window: window ?? null };
        s().categories.push(row);
      }
      return saved(row);
    },

    async deleteCategory(categoryId) {
      const idx = s().categories.findIndex((c) => c.id === categoryId);
      if (idx < 0) fail('not_found');
      if (s().items.some((i) => i.categoryId === categoryId)) fail('in_use');
      s().categories.splice(idx, 1);
      if (s().shop.nudgeCategoryId === categoryId) s().shop.nudgeCategoryId = null;
      ctx.emit();
    },

    async saveItem(input) {
      assertShop(ctx, input.shopId);
      const st = s();
      const name = text(input.name, 60, 'name');
      const description = input.description === undefined ? undefined : text(input.description, 300, 'description', true);
      const priceSen = checkPrice(input.priceSen, 10_000_000, 'price_sen');
      if (!st.categories.some((c) => c.id === input.categoryId)) fail('invalid_input', 'category_id');
      if (input.stationId && !st.stations.some((x) => x.id === input.stationId)) fail('invalid_input', 'station_id');
      if (input.isCombo) gate(ctx, 'combos');
      let row: ItemRow;
      if (input.id) {
        row = st.items.find((i) => i.id === input.id) ?? fail('not_found');
      } else {
        const station = input.stationId ?? defaultStation(st)?.id ?? fail('not_found', 'station');
        row = {
          id: ctx.id('item'), shopId: input.shopId, categoryId: input.categoryId, stationId: station, name, description: '', translations: {},
          priceSen, photoUrl: null, photoState: 'none', active: true, soldOut: false, isCombo: false,
          sort: nextSort(st.items.filter((i) => i.categoryId === input.categoryId)),
        };
        st.items.push(row);
      }
      Object.assign(row, { name, categoryId: input.categoryId, priceSen });
      if (input.stationId) row.stationId = input.stationId;
      if (description !== undefined) row.description = description;
      if (input.translations) row.translations = copy(input.translations);
      if (input.active !== undefined) row.active = input.active;
      if (input.soldOut !== undefined) row.soldOut = input.soldOut;
      if (input.isCombo !== undefined) row.isCombo = input.isCombo;
      return saved(row);
    },

    async uploadItemPhoto(shopId, itemId, file) {
      assertShop(ctx, shopId);
      const row = s().items.find((i) => i.id === itemId) ?? fail('not_found');
      row.photoUrl = await resizedDataUrl(file);
      row.photoState = 'staging';
      return saved(row);
    },

    async saveModifierGroup(input) {
      assertShop(ctx, input.shopId);
      const name = text(input.name, 40, 'name');
      const { minSelect, maxSelect } = input;
      if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect) || minSelect < 0 || maxSelect < 1 || maxSelect < minSelect) fail('invalid_input', 'select');
      if (!s().items.some((i) => i.id === input.itemId)) fail('invalid_input', 'item_id');
      let row: ModifierGroupRow;
      if (input.id) {
        row = s().groups.find((g) => g.id === input.id) ?? fail('not_found');
      } else {
        row = { id: ctx.id('group'), shopId: input.shopId, itemId: input.itemId, name, translations: {}, minSelect, maxSelect, sort: nextSort(s().groups.filter((g) => g.itemId === input.itemId)) };
        s().groups.push(row);
      }
      Object.assign(row, { name, minSelect, maxSelect });
      if (input.translations) row.translations = copy(input.translations);
      return saved(row);
    },

    async deleteModifierGroup(groupId) {
      const idx = s().groups.findIndex((g) => g.id === groupId);
      if (idx < 0) fail('not_found');
      s().groups.splice(idx, 1);
      s().options = s().options.filter((o) => o.groupId !== groupId);
      ctx.emit();
    },

    async saveModifierOption(input) {
      assertShop(ctx, input.shopId);
      const name = text(input.name, 40, 'name');
      const priceDeltaSen = checkPrice(input.priceDeltaSen, 1_000_000, 'price_delta_sen');
      if (!s().groups.some((g) => g.id === input.groupId)) fail('invalid_input', 'group_id');
      let row: ModifierOptionRow;
      if (input.id) {
        row = s().options.find((o) => o.id === input.id) ?? fail('not_found');
      } else {
        row = { id: ctx.id('opt'), shopId: input.shopId, groupId: input.groupId, name, translations: {}, priceDeltaSen, sort: nextSort(s().options.filter((o) => o.groupId === input.groupId)) };
        s().options.push(row);
      }
      Object.assign(row, { name, priceDeltaSen });
      if (input.translations) row.translations = copy(input.translations);
      return saved(row);
    },

    async deleteModifierOption(optionId) {
      const idx = s().options.findIndex((o) => o.id === optionId);
      if (idx < 0) fail('not_found');
      s().options.splice(idx, 1);
      ctx.emit();
    },

    async reorder(kind: ReorderKind, orderedIds) {
      const st = s();
      const rows: Record<ReorderKind, { id: string; sort: number }[]> = {
        categories: st.categories, items: st.items, modifier_groups: st.groups, modifier_options: st.options, stations: st.stations, tables: st.tables,
      };
      const list = rows[kind];
      if (new Set(orderedIds).size !== orderedIds.length) fail('invalid_input', 'ids');
      const found = orderedIds.map((id) => list.find((r) => r.id === id) ?? fail('not_found', id));
      found.forEach((r, i) => (r.sort = i));
      ctx.emit();
    },

    async setPairings(itemId, suggestedItemIds) {
      const st = s();
      if (!st.items.some((i) => i.id === itemId)) fail('not_found');
      gate(ctx, 'manual_pairings');
      if (suggestedItemIds.length > 3 || new Set(suggestedItemIds).size !== suggestedItemIds.length) fail('invalid_input', 'suggested');
      if (suggestedItemIds.some((id) => id === itemId || !st.items.some((i) => i.id === id))) fail('invalid_input', 'suggested');
      st.pairings = st.pairings.filter((p) => p.sourceItemId !== itemId);
      suggestedItemIds.forEach((id, i) => st.pairings.push({ sourceItemId: itemId, suggestedItemId: id, position: (i + 1) as 1 | 2 | 3 }));
      ctx.emit();
    },

    async listTables(shopId) {
      assertShop(ctx, shopId);
      return copy([...s().tables].sort(bySort));
    },

    async saveTable(input) {
      assertShop(ctx, input.shopId);
      const label = text(input.label, 20, 'label');
      const existing = input.id ? (s().tables.find((t) => t.id === input.id) ?? fail('not_found')) : undefined;
      const kind = existing?.kind ?? input.kind ?? 'table';
      if (!existing && kind === 'counter') gate(ctx, 'takeaway');
      const active = input.active ?? existing?.active ?? true;
      if (active) {
        assertLabelFree(label, existing);
        if (!existing?.active && kind === 'table') assertWithinLimit(ctx, 'max_tables', activeTables(existing));
      }
      const row: TableRow = existing ?? { id: ctx.id('table'), shopId: input.shopId, label, kind, token: newToken(), active, sort: nextSort(s().tables) };
      if (!existing) s().tables.push(row);
      row.label = label;
      row.active = active;
      return saved(row);
    },

    async regenerateTableToken(tableId) {
      const row = s().tables.find((t) => t.id === tableId) ?? fail('not_found');
      row.token = newToken();
      return saved(row);
    },

    async listStaff(shopId) {
      assertShop(ctx, shopId);
      return copy(s().staff);
    },

    async addStaff(shopId, name, pin) {
      assertShop(ctx, shopId);
      gate(ctx, 'staff_pins');
      const clean = text(name, 40, 'name');
      if (!PIN.test(pin)) fail('invalid_input', 'pin');
      assertPinFree(pin, null);
      assertWithinLimit(ctx, 'max_staff', activeCount(s().staff));
      const row: StaffRow = { id: ctx.id('staff'), shopId, name: clean, active: true, createdAt: nowIso(ctx) };
      s().staff.push(row);
      s().staffPins.push({ staffId: row.id, pin });
      return saved(row);
    },

    async updateStaff(staffId, patch) {
      const row = s().staff.find((m) => m.id === staffId) ?? fail('not_found');
      const name = patch.name === undefined ? row.name : text(patch.name, 40, 'name');
      if (patch.active === true && !row.active) {
        const pin = s().staffPins.find((p) => p.staffId === row.id)?.pin;
        if (pin) assertPinFree(pin, row.id);
        assertWithinLimit(ctx, 'max_staff', activeCount(s().staff, row));
      }
      row.name = name;
      if (patch.active !== undefined) row.active = patch.active;
      if (!row.active && s().actorStaffId === row.id) s().actorStaffId = null; // its session is deleted
      ctx.emit();
    },

    async resetStaffPin(staffId, pin) {
      const row = s().staff.find((m) => m.id === staffId) ?? fail('not_found');
      if (!PIN.test(pin)) fail('invalid_input', 'pin');
      assertPinFree(pin, row.id);
      const entry = s().staffPins.find((p) => p.staffId === row.id);
      if (entry) entry.pin = pin;
      else s().staffPins.push({ staffId: row.id, pin });
      ctx.emit();
    },

    async getDailySummary(shopId, day) {
      assertShop(ctx, shopId);
      return getDailySummary(ctx, day);
    },

    async getShopPlan(shopId) {
      assertShop(ctx, shopId);
      const st = s();
      return {
        planId: st.plan,
        entitlements: entitlements(ctx),
        usage: { tables: activeTables(), stations: activeCount(st.stations), staff: activeCount(st.staff) },
        askTerasWhatsapp: null,
      };
    },
  };
}

/** A 24-character URL-safe token (demo tokens are not secret). */
export function newToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
