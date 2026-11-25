import { useState } from 'react';
import { useData } from '../../data/context';
import { isLaparError, type CategoryInput, type CategoryRow, type ItemRow, type MenuEditorDTO } from '../../data/types';
import { formatRM } from '../../lib/money';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, inputClass, Loading, PhotoTile, Sheet } from '../../ui';
import { useAct, useLoad, moved } from './hooks';
import { ItemEditor } from './ItemEditor';
import { useManagerT } from './messages';
import { Card, Heading, Tag, UpDown } from './parts';
import { CategoryProFields } from './pro/CategoryProFields';

const NAME_MAX = 40;
const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;

type Editing = { itemId: string | null; categoryId: string } | null;

export function MenuSection({ shopId }: { shopId: string }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const q = useLoad(() => api.owner.getMenuEditor(shopId), shopId);
  const [editing, setEditing] = useState<Editing>(null);
  const [cat, setCat] = useState<{ draft: CategoryInput; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  if (!q.data) return q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : <Loading />;
  const editor = q.data;
  const categories = [...editor.categories].sort(bySort);
  const itemsOf = (categoryId: string) => editor.items.filter((i) => i.categoryId === categoryId).sort(bySort);

  if (editing) {
    return (
      <ItemEditor
        key={editing.itemId ?? 'new'}
        shopId={shopId}
        editor={editor}
        itemId={editing.itemId}
        categoryId={editing.categoryId}
        onChanged={q.reload}
        onBack={() => {
          setEditing(null);
          q.reload();
        }}
      />
    );
  }

  const reorder = async (kind: 'categories' | 'items', ids: string[] | null) => {
    if (ids && (await run(() => api.owner.reorder(kind, ids)))) q.reload();
  };

  const saveCat = async () => {
    if (!cat) return;
    const name = cat.draft.name.trim();
    if (!name) return setCat({ ...cat, error: t('name_required') });
    if (name.length > NAME_MAX) return setCat({ ...cat, error: t('name_too_long', { max: NAME_MAX }) });
    if (await run(() => api.owner.saveCategory({ ...cat.draft, name }), t('saved'))) {
      setCat(null);
      q.reload();
    }
  };

  const removeCat = async () => {
    if (!deleting) return;
    await run(
      () => api.owner.deleteCategory(deleting.id),
      t('category_deleted'),
      (e) => (isLaparError(e, 'in_use') ? t('category_in_use') : null),
    );
    setDeleting(null);
    q.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading aside={<Button onClick={() => setCat({ draft: { shopId, name: '' }, error: null })}>{t('add_category')}</Button>}>{t('menu_title')}</Heading>

      {categories.length === 0 && <EmptyState title={t('no_categories')}>{t('no_categories_body')}</EmptyState>}

      {categories.map((c, i) => {
        const items = itemsOf(c.id);
        return (
          <Card key={c.id} className="flex flex-col gap-3">
            <section aria-label={c.name} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold text-stone-900">{c.name}</h3>
                <div className="flex gap-1">
                  <UpDown
                    index={i}
                    count={categories.length}
                    name={c.name}
                    onMove={(d) =>
                      void reorder(
                        'categories',
                        moved(
                          categories.map((x) => x.id),
                          i,
                          d,
                        ),
                      )
                    }
                  />
                  <IconButton label={t('rename_named', { name: c.name })} onClick={() => setCat({ draft: { id: c.id, shopId, name: c.name, translations: c.translations, window: c.window }, error: null })}>
                    ✎
                  </IconButton>
                  <IconButton label={t('delete_named', { name: c.name })} onClick={() => setDeleting(c)}>
                    🗑
                  </IconButton>
                </div>
              </div>
              {items.length === 0 ? (
                <p className="text-stone-600">{t('no_items')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-stone-200">
                  {items.map((item, n) => (
                    <ItemRowView
                      key={item.id}
                      item={item}
                      index={n}
                      count={items.length}
                      onOpen={() => setEditing({ itemId: item.id, categoryId: c.id })}
                      onMove={(d) =>
                        void reorder(
                          'items',
                          moved(
                            items.map((x) => x.id),
                            n,
                            d,
                          ),
                        )
                      }
                    />
                  ))}
                </ul>
              )}
              <Button variant="secondary" onClick={() => setEditing({ itemId: null, categoryId: c.id })} aria-label={t('add_item_to', { name: c.name })}>
                {t('add_item')}
              </Button>
            </section>
          </Card>
        );
      })}

      <NudgeCard shopId={shopId} editor={editor} onSaved={q.reload} />

      <Sheet open={!!cat} onClose={() => setCat(null)} title={cat?.draft.id ? t('rename_category') : t('add_category')}>
        {cat && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveCat();
            }}
          >
            <Field label={t('category_name')} error={cat.error}>
              {(p) => <input {...p} className={inputClass} value={cat.draft.name} onChange={(e) => setCat({ draft: { ...cat.draft, name: e.target.value }, error: null })} />}
            </Field>
            <CategoryProFields draft={cat.draft} onDraftChange={(draft) => setCat({ ...cat, draft })} editor={editor} />
            <Button type="submit" disabled={busy}>
              {t('save')}
            </Button>
          </form>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        danger
        busy={busy}
        title={t('delete_category_title', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete')}
        onConfirm={() => void removeCat()}
        onCancel={() => setDeleting(null)}
      >
        {t('delete_category_body')}
      </ConfirmDialog>
    </div>
  );
}

function ItemRowView({ item, index, count, onOpen, onMove }: { item: ItemRow; index: number; count: number; onOpen: () => void; onMove: (d: -1 | 1) => void }) {
  const t = useManagerT();
  return (
    <li className="flex items-center gap-2 py-2">
      <button type="button" onClick={onOpen} aria-label={t('edit_named', { name: item.name })} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-orange-600">
        <PhotoTile url={item.photoUrl} name={item.name} className="size-12" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-stone-900">{item.name}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-stone-700">
            {formatRM(item.priceSen)}
            {!item.active && <Tag>{t('inactive')}</Tag>}
            {item.soldOut && <Tag>{t('sold_out')}</Tag>}
          </span>
        </span>
      </button>
      <UpDown index={index} count={count} name={item.name} onMove={onMove} />
    </li>
  );
}

/** The checkout nudge: the category offered before the customer orders (usually Drinks). */
function NudgeCard({ shopId, editor, onSaved }: { shopId: string; editor: MenuEditorDTO; onSaved: () => void }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const [value, setValue] = useState(editor.nudgeCategoryId ?? '');
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg font-bold text-stone-900">{t('nudge_title')}</h3>
      <Field label={t('nudge_category')} hint={t('nudge_hint')}>
        {(p) => (
          <select {...p} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">{t('none')}</option>
            {[...editor.categories].sort(bySort).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Button variant="secondary" disabled={busy || value === (editor.nudgeCategoryId ?? '')} onClick={() => void run(() => api.owner.updateShopSettings(shopId, { nudgeCategoryId: value || null }), t('saved')).then((r) => r !== undefined && onSaved())}>
        {t('save')}
      </Button>
    </Card>
  );
}
