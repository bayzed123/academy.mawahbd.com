import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codCharge, fromBnDigits, SHOP_MAX_PICTURES, type ShopOrderDTO, type ShopOrderStatus } from "@mawah/shared";
import { adm, api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { compressImage } from "../lib/image";
import { useI18n } from "../lib/i18n";
import type { FieldDef } from "../components/Form";
import { ResourcePage } from "../components/ResourcePage";
import { emptyVariant } from "../components/ShopVariants";
import { Button, Chip, Empty, ErrorState, Field, IconButton, KV, PageHeader, SlideOver, Spinner, StatusChip, Switch, Tabs, TextInput, useConfirm, useToast } from "../components/ui";

/*
 * Admin → Shop: everything about the tools shop on one screen, in tabs — the products (weights and prices, pictures, descriptions), the
 * categories, the orders (from "placed" to "delivered"), the buyers' reviews, and the shop's own settings (open or closed, how buyers pay,
 * what delivery costs). The public pages are /shop; the cart and the checkout are in the student app.
 */

type Tab = "products" | "categories" | "orders" | "reviews" | "settings";

export function Shop() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs: { value: Tab; label: string }[] = [
    { value: "products", label: t("adm.shop.tab.products") },
    { value: "categories", label: t("adm.shop.tab.categories") },
    ...(can("shop:orders") ? [{ value: "orders" as const, label: t("adm.shop.tab.orders") }] : []),
    { value: "reviews", label: t("adm.shop.tab.reviews") },
    ...(can("settings:read") ? [{ value: "settings" as const, label: t("adm.shop.tab.settings") }] : []),
  ];
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && tabs.some((x) => x.value === asked) ? asked : "products";
  return (
    <>
      <Tabs value={tab} onChange={(v) => setParams(v === "products" ? {} : { tab: v }, { replace: true })} tabs={tabs} />
      {tab === "products" && <Products />}
      {tab === "categories" && <Categories />}
      {tab === "orders" && <Orders />}
      {tab === "reviews" && <Reviews />}
      {tab === "settings" && (
        <>
          <StoreSettings />
          <CourierSettings />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ products */
interface ProductRow {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  status: string;
  category_id: number | null;
  image: string | null;
  pictures: number;
  sold: number;
  variants: { id: number; label_bn: string; label_en: string; price: number; list_price: number; stock: number | null }[];
}
interface CategoryRow {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  active: number;
  sort: number;
  products?: number;
}

const useCategories = () => useQuery({ queryKey: ["/shop/categories", "options"], queryFn: () => adm<{ items: CategoryRow[] }>("/shop/categories?per_page=100&sort=sort") });

function Products() {
  const { t, pick, money, num } = useI18n();
  const cats = useCategories();
  const [pictures, setPictures] = useState<ProductRow | null>(null);
  const options = (cats.data?.items ?? []).map((c) => ({ value: String(c.id), label: pick(c, "name") }));
  const fields: FieldDef[] = [
    { type: "text", key: "name_bn", label: t("adm.shop.nameBn"), half: true, required: true, maxLength: 160 },
    { type: "text", key: "name_en", label: t("adm.shop.nameEn"), half: true, required: true, maxLength: 160 },
    { type: "select", key: "category_id", label: t("adm.shop.category"), half: true, options, nullable: true, numeric: true, emptyLabel: t("adm.shop.noCategory") },
    { type: "select", key: "status", label: t("label.status"), half: true, options: ["draft", "published", "archived"].map((s) => ({ value: s, label: t(`status.${s}` as "status.draft") })), hint: t("adm.shop.statusHint") },
    { type: "section", key: "s-prices", label: t("adm.shop.variants") },
    { type: "variants", key: "variants", label: t("adm.shop.variants"), required: true },
    { type: "section", key: "s-words", label: t("adm.shop.words") },
    { type: "textarea", key: "short_bn", label: t("adm.shop.shortBn"), half: true, maxLength: 300, hint: t("adm.shop.shortHint") },
    { type: "textarea", key: "short_en", label: t("adm.shop.shortEn"), half: true, maxLength: 300 },
    { type: "markdown", key: "body_bn", label: t("adm.shop.bodyBn"), half: true, maxLength: 8000 },
    { type: "markdown", key: "body_en", label: t("adm.shop.bodyEn"), half: true, maxLength: 8000 },
    { type: "switch", key: "featured", label: t("adm.shop.featured"), half: true },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999 },
  ];
  return (
    <>
      <ResourcePage<ProductRow>
        title={t("adm.shop.tab.products")}
        sub={t("adm.shop.products.sub")}
        endpoint="/shop/products"
        perms={{ write: "shop:write" }}
        fields={fields}
        wide
        defaults={{ name_bn: "", name_en: "", category_id: null, status: "draft", short_bn: "", short_en: "", body_bn: "", body_en: "", featured: false, sort: 100, variants: [emptyVariant()] }}
        rowLabel={(r) => r.name_en}
        defaultSort="sort"
        searchPlaceholder={t("adm.shop.search")}
        filters={[
          { key: "status", label: t("label.status"), options: ["draft", "published", "archived"].map((s) => ({ value: s, label: t(`status.${s}` as "status.draft") })) },
          ...(options.length ? [{ key: "category_id", label: t("adm.shop.category"), options }] : []),
        ]}
        rowActions={(r) => <IconButton icon="image" label={t("adm.shop.picturesOf", { name: pick(r, "name") })} onClick={() => setPictures(r)} />}
        columns={[
          {
            key: "name",
            label: t("adm.shop.product"),
            sort: "name_en",
            render: (r) => (
              <span className="row nowrap">
                <span className="thumb-sm">{r.image ? <img src={`/media/${r.image}`} alt="" /> : null}</span>
                <b>{pick(r, "name")}</b>
              </span>
            ),
          },
          {
            key: "price",
            label: t("label.price"),
            render: (r) => {
              const prices = (r.variants ?? []).map((v) => v.price);
              if (!prices.length) return <Chip tone="warn">{t("adm.shop.noPrice")}</Chip>;
              const lo = Math.min(...prices);
              const hi = Math.max(...prices);
              return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
            },
          },
          { key: "stock", label: t("adm.shop.stock"), desktopOnly: true, render: (r) => ((r.variants ?? []).every((v) => v.stock === null) ? "—" : num((r.variants ?? []).reduce((s, v) => s + (v.stock ?? 0), 0))) },
          { key: "sold", label: t("adm.shop.sold"), desktopOnly: true, className: "num", render: (r) => num(r.sold ?? 0) },
          { key: "status", label: t("label.status"), sort: "status", render: (r) => <StatusChip status={r.status} /> },
        ]}
      />
      <SlideOver open={!!pictures} onClose={() => setPictures(null)} title={pictures ? t("adm.shop.picturesOf", { name: pick(pictures, "name") }) : ""} wide>
        {pictures && <ProductPictures productId={pictures.id} />}
      </SlideOver>
    </>
  );
}

/** A product's pictures: each is made into a large and a small copy in the browser, then added; the first one is the card's. */
function ProductPictures({ productId }: { productId: number }) {
  const { t, err, num } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canWrite = can("shop:write");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const key = ["shop-images", productId];
  const list = useQuery({ queryKey: key, queryFn: () => adm<{ items: { id: number; image_key: string; thumb_key: string | null }[]; max: number }>(`/shop/products/${productId}/images`) });
  const items = list.data?.items ?? [];
  const upload = async (blob: Blob) => (await api<{ key: string }>("/admin/media/image?folder=gallery", { body: blob, contentType: blob.type || "image/webp" })).key;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ["/shop/products"] });
  };
  const add = async (files: File[]) => {
    setBusy(true);
    for (const file of files.slice(0, Math.max(0, SHOP_MAX_PICTURES - items.length))) {
      try {
        const large = await compressImage(file, { maxWidth: 1400 });
        const small = await compressImage(file, { maxWidth: 480, quality: 0.8 });
        const image_key = await upload(large);
        const thumb_key = small === large ? image_key : await upload(small);
        await adm(`/shop/products/${productId}/images`, { json: { image_key, thumb_key: thumb_key === image_key ? undefined : thumb_key } });
      } catch (e) {
        toast(err(e instanceof ApiError ? (e.code === "unsupported_file_type" ? "file_type" : e.code) : "generic"), true);
      }
    }
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    await refresh();
  };
  const move = useMutation({
    mutationFn: (ids: number[]) => adm(`/shop/products/${productId}/images/order`, { json: { ids } }),
    onSuccess: refresh,
  });
  const remove = async (id: number) => {
    if (!(await confirm({ title: t("adm.shop.pictureRemove"), danger: true }))) return;
    await adm(`/shop/products/${productId}/images/${id}`, { method: "DELETE" });
    await refresh();
  };
  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <div className="stack">
      <p className="muted">{t("adm.shop.picturesHint", { max: num(SHOP_MAX_PICTURES) })}</p>
      {canWrite && items.length < SHOP_MAX_PICTURES && (
        <div className="row">
          <label className="btn btn-outline" htmlFor="shop-pic">
            {t("adm.shop.pictureAdd")}
          </label>
          <input id="shop-pic" ref={fileInput} className="vh" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => void add(Array.from(e.target.files ?? []))} />
          {busy && <span className="spinner sm" aria-hidden="true" />}
        </div>
      )}
      {items.length === 0 ? (
        <Empty icon="image" title={t("adm.shop.noPictures")} />
      ) : (
        <ul className="shop-pics">
          {items.map((p, i) => (
            <li key={p.id}>
              <img src={`/media/${p.thumb_key ?? p.image_key}`} alt={t("adm.shop.pictureN", { n: num(i + 1) })} />
              {i === 0 && <Chip tone="gold">{t("adm.shop.pictureMain")}</Chip>}
              {canWrite && (
                <span className="row">
                  <IconButton icon="up" label={t("adm.shop.pictureUp", { n: num(i + 1) })} disabled={i === 0} onClick={() => move.mutate(items.map((x) => x.id).toSpliced(i - 1, 2, items[i].id, items[i - 1].id))} />
                  <IconButton icon="down" label={t("adm.shop.pictureDown", { n: num(i + 1) })} disabled={i === items.length - 1} onClick={() => move.mutate(items.map((x) => x.id).toSpliced(i, 2, items[i + 1].id, items[i].id))} />
                  <IconButton icon="trash" label={t("adm.shop.pictureDelete", { n: num(i + 1) })} onClick={() => void remove(p.id)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- categories */
function Categories() {
  const { t, pick, num } = useI18n();
  const fields: FieldDef[] = [
    { type: "text", key: "name_bn", label: t("adm.shop.nameBn"), half: true, required: true, maxLength: 80 },
    { type: "text", key: "name_en", label: t("adm.shop.nameEn"), half: true, required: true, maxLength: 80 },
    { type: "switch", key: "active", label: t("adm.shop.catShown"), half: true },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999 },
  ];
  return (
    <ResourcePage<CategoryRow>
      title={t("adm.shop.tab.categories")}
      sub={t("adm.shop.categories.sub")}
      endpoint="/shop/categories"
      perms={{ write: "shop:write" }}
      fields={fields}
      defaults={{ name_bn: "", name_en: "", active: true, sort: 100 }}
      rowLabel={(r) => r.name_en}
      defaultSort="sort"
      csv={false}
      columns={[
        { key: "name", label: t("adm.shop.category"), sort: "name_en", render: (r) => <b>{pick(r, "name")}</b> },
        { key: "products", label: t("adm.shop.tab.products"), className: "num", render: (r) => num(r.products ?? 0) },
        { key: "active", label: t("label.status"), render: (r) => <StatusChip status={r.active ? "active" : "hidden"} /> },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------------------------------------------------- orders */
interface OrderRow {
  id: number;
  public_id: string;
  status: ShopOrderStatus;
  payment: "cod" | "sslcommerz";
  total: number;
  name: string;
  phone: string;
  place: string;
  created_at: string;
}
type OrderDetail = ShopOrderDTO & {
  id: number;
  staff_note: string;
  gateway_txn: string | null;
  next: ShopOrderStatus[];
  courier_cid: string;
  courier_status: string;
  courier_at: string | null;
  courier_events: { courier: Courier; event: string; status: string; message: string; created_at: string }[];
};
type Courier = "steadfast" | "pathao";
const COURIER_NAME: Record<Courier, string> = { steadfast: "Steadfast", pathao: "Pathao" };
/** Why a courier did not take a parcel, in words of our own (the courier's own sentence follows them). */
const COURIER_ERRORS = ["no_keys", "no_store", "refused", "unreachable", "unanswered", "bad_step", "already_booked"] as const;
interface CourierSetup {
  steadfast: boolean;
  pathao: boolean;
  pathao_store: number;
  pathao_store_name: string;
  weight: number;
}

/**
 * Sending a confirmed order to Steadfast or Pathao (their keys on the website): the cash the courier collects, a line for the rider, the
 * weight Pathao asks for, and the courier's refusal in its own words. Once booked: which courier has it, its numbers, and every word the
 * courier sent about the parcel since.
 */
function CourierBox({ o, canAct, onBooked }: { o: OrderDetail; canAct: boolean; onBooked: (o: OrderDetail) => void }) {
  const { t, money, dateTime, err } = useI18n();
  const toast = useToast();
  const setup = useQuery({ queryKey: ["shop-couriers"], queryFn: () => adm<CourierSetup>("/shop/couriers"), staleTime: 60_000 });
  const [note, setNote] = useState("");
  const [weight, setWeight] = useState("");
  const [refused, setRefused] = useState("");
  const book = useMutation({
    mutationFn: (courier: Courier) =>
      adm<{ order: OrderDetail }>(`/shop/orders/${o.public_id}/courier`, { json: { courier, note: note.trim() || undefined, weight: weight ? Number(fromBnDigits(weight)) || undefined : undefined } }),
    onSuccess: (r) => {
      setRefused("");
      onBooked(r.order);
      toast(t("adm.shop.cr.booked", { courier: COURIER_NAME[r.order.courier as Courier] }));
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code.replace(/^courier_/, "") : "generic";
      const said = e instanceof ApiError ? (e.fields?.detail ?? "") : "";
      const words = (COURIER_ERRORS as readonly string[]).includes(code) ? t(`adm.shop.cr.err.${code}` as "adm.shop.cr.err.refused") : err(code);
      setRefused(`${words}${said ? ` — “${said}”` : ""}`);
    },
  });
  if (o.courier) {
    return (
      <section className="courier-box" aria-label={t("adm.shop.cr.title")}>
        <p>
          <b>{t("adm.shop.cr.with", { courier: COURIER_NAME[o.courier] })}</b> · {t("adm.shop.cr.cid", { cid: o.courier_cid })} · {t("adm.shop.cr.tracking", { ref: o.courier_ref })}
        </p>
        {o.courier_status && (
          <p>
            {t("adm.shop.cr.says", { word: o.courier_status })}
            {o.courier_at ? ` · ${dateTime(o.courier_at)}` : ""}
          </p>
        )}
        {o.courier_events.length > 0 && (
          <ol className="courier-log">
            {o.courier_events.map((ev, i) => (
              <li key={i}>
                <span className="muted">{dateTime(ev.created_at)}</span> {ev.status || ev.event}
                {ev.message ? ` — ${ev.message}` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }
  if (!canAct || o.status !== "confirmed" || !setup.data || !(setup.data.steadfast || setup.data.pathao)) return null;
  const s = setup.data;
  return (
    <fieldset className="courier-box plain-fieldset">
      <legend>{t("adm.shop.cr.title")}</legend>
      <p className="hint">{o.payment === "cod" ? t("adm.shop.cr.collect", { amount: money(o.total) }) : t("adm.shop.cr.paid")}</p>
      <Field id="cr-note" label={t("adm.shop.cr.note")} hint={t("adm.shop.cr.noteHint")}>
        <TextInput id="cr-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {s.pathao && (
        <Field id="cr-weight" label={t("adm.shop.cr.weight")} hint={t("adm.shop.cr.weightHint", { kg: String(s.weight) })}>
          <TextInput id="cr-weight" inputMode="decimal" value={weight} placeholder={String(s.weight)} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      )}
      <div className="row">
        {s.steadfast && (
          <Button className="btn-primary" busy={book.isPending && book.variables === "steadfast"} disabled={book.isPending} onClick={() => book.mutate("steadfast")}>
            {t("adm.shop.cr.send", { courier: "Steadfast" })}
          </Button>
        )}
        {s.pathao && (
          <Button className="btn-primary" busy={book.isPending && book.variables === "pathao"} disabled={book.isPending || !s.pathao_store} onClick={() => book.mutate("pathao")}>
            {t("adm.shop.cr.send", { courier: "Pathao" })}
          </Button>
        )}
      </div>
      {s.pathao && !s.pathao_store && <p className="hint">{t("adm.shop.cr.needStore")}</p>}
      {refused && (
        <p className="err-text" role="alert">
          {refused}
        </p>
      )}
    </fieldset>
  );
}

const ORDER_FILTERS = ["open", "placed", "paid", "review", "confirmed", "shipped", "delivered", "pending", "cancelled", "failed", "refunded", ""] as const;

function Orders() {
  const { t, money, date } = useI18n();
  const [status, setStatus] = useState<(typeof ORDER_FILTERS)[number]>("open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["shop-orders", status, q],
    queryFn: () => adm<{ items: OrderRow[]; counts: Record<string, number> }>(`/shop/orders?status=${status}&q=${encodeURIComponent(q)}&per_page=50`),
  });
  return (
    <>
      <PageHeader title={t("adm.shop.tab.orders")} sub={t("adm.shop.orders.sub")} />
      <div className="toolbar">
        <label className="vh" htmlFor="so-status">
          {t("label.status")}
        </label>
        <select id="so-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {ORDER_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "" ? t("label.all") : s === "open" ? t("adm.shop.openOrders") : t(`adm.shop.st.${s}` as "adm.shop.st.placed")}
              {s && s !== "open" && list.data?.counts[s] ? ` (${list.data.counts[s]})` : ""}
            </option>
          ))}
        </select>
        <label className="vh" htmlFor="so-q">
          {t("adm.shop.searchOrders")}
        </label>
        <input id="so-q" className="input" type="search" placeholder={t("adm.shop.searchOrders")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Empty icon="inbox" title={t("adm.shop.noOrders")} />
      ) : (
        // the list scrolls inside its own box on a phone, like every other list in Admin (the page itself never scrolls sideways)
        <div className="table-wrap table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("adm.shop.order")}</th>
                <th>{t("adm.shop.customer")}</th>
                <th className="num">{t("label.total")}</th>
                <th>{t("adm.shop.payment")}</th>
                <th>{t("label.status")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <button type="button" className="link" onClick={() => setOpen(o.public_id)}>
                      <code>{o.public_id}</code>
                    </button>
                    <div className="muted small">{date(o.created_at)}</div>
                  </td>
                  <td>
                    <b>{o.name}</b>
                    <div className="muted small">
                      {o.phone} · {o.place}
                    </div>
                  </td>
                  <td className="num">{money(o.total)}</td>
                  <td>{o.payment === "cod" ? t("adm.shop.cod") : t("adm.shop.online")}</td>
                  <td>
                    <OrderChip status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SlideOver open={!!open} onClose={() => setOpen(null)} title={open ? t("adm.shop.orderN", { code: open }) : ""} wide>
        {open && <OrderPanel code={open} />}
      </SlideOver>
    </>
  );
}

const ORDER_TONE: Record<ShopOrderStatus, "neutral" | "ok" | "warn" | "bad" | "info" | "gold"> = {
  pending: "neutral",
  placed: "warn",
  paid: "warn",
  review: "bad",
  confirmed: "info",
  shipped: "gold",
  delivered: "ok",
  cancelled: "neutral",
  failed: "neutral",
  refunded: "bad",
};
function OrderChip({ status }: { status: ShopOrderStatus }) {
  const { t } = useI18n();
  return <Chip tone={ORDER_TONE[status]}>{t(`adm.shop.st.${status}` as "adm.shop.st.placed")}</Chip>;
}

function OrderPanel({ code }: { code: string }) {
  const { t, money, date, pick, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [courier, setCourier] = useState("");
  const [note, setNote] = useState("");
  const order = useQuery({ queryKey: ["shop-order", code], queryFn: async () => (await adm<{ order: OrderDetail }>(`/shop/orders/${code}`)).order });
  useEffect(() => {
    if (order.data) {
      setCourier(order.data.courier_ref);
      setNote(order.data.staff_note);
    }
  }, [order.data]);
  const step = useMutation({
    mutationFn: (status: ShopOrderStatus) => adm<{ order: OrderDetail }>(`/shop/orders/${code}/status`, { json: { status, courier_ref: courier.trim(), staff_note: note.trim() } }),
    onSuccess: (r) => {
      qc.setQueryData(["shop-order", code], r.order);
      void qc.invalidateQueries({ queryKey: ["shop-orders"] });
      toast(t("adm.saved"));
    },
    onError: (e) => toast(e instanceof ApiError && e.code === "bad_step" ? t("adm.shop.badStep") : err(e instanceof ApiError ? e.code : "generic"), true),
  });
  if (order.isPending) return <Spinner />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;
  const o = order.data;
  const canAct = can("shop:orders_write");
  const go = async (s: ShopOrderStatus) => {
    if (s === "cancelled" && !(await confirm({ title: t("adm.shop.cancelQ"), body: o.paid_at ? t("adm.shop.cancelPaid") : t("adm.shop.cancelBody"), danger: true }))) return;
    step.mutate(s);
  };
  return (
    <div className="stack">
      <div className="row">
        <OrderChip status={o.status} />
        <span className="muted">{date(o.created_at)}</span>
      </div>
      {o.status === "review" && <p className="notice bad-note">{t("adm.shop.reviewNote")}</p>}
      <KV
        items={[
          { label: t("adm.shop.customer"), value: `${o.name} · ${o.phone}${o.email ? ` · ${o.email}` : ""}` },
          { label: t("adm.shop.deliverTo"), value: `${o.address}, ${o.place}` },
          ...(o.note ? [{ label: t("adm.shop.buyerNote"), value: o.note }] : []),
          { label: t("adm.shop.payment"), value: `${o.payment === "cod" ? t("adm.shop.cod") : t("adm.shop.online")}${o.gateway_txn ? ` · ${o.gateway_txn}` : ""}` },
        ]}
      />
      {/* compact: three narrow columns that fit the drawer on a 360 px phone */}
      <table className="table compact">
        <tbody>
          {o.items.map((i, n) => (
            <tr key={n}>
              <td>
                {pick(i, "name")}
                {pick(i, "label") ? ` · ${pick(i, "label")}` : ""}
              </td>
              <td className="num">{`×\u00a0${i.qty}`}</td>
              <td className="num">{money(i.price * i.qty)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>{t("adm.shop.delivery")}</td>
            <td className="num">{money(o.delivery_fee)}</td>
          </tr>
          {o.cod_fee > 0 && (
            <tr>
              <td colSpan={2}>{t("adm.shop.codCharge")}</td>
              <td className="num">{money(o.cod_fee)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={2}>
              <b>{t("label.total")}</b>
            </td>
            <td className="num">
              <b>{money(o.total)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      {canAct && o.next.length > 0 && (
        <>
          <Field id="so-courier" label={t("adm.shop.courierRef")} hint={t("adm.shop.courierHint")}>
            <TextInput id="so-courier" value={courier} maxLength={80} onChange={(e) => setCourier(e.target.value)} />
          </Field>
          <Field id="so-note" label={t("adm.shop.staffNote")}>
            <TextInput id="so-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="row">
            {o.next.map((s) => (
              <Button key={s} className={s === "cancelled" ? "btn-ghost" : "btn-primary"} busy={step.isPending && step.variables === s} onClick={() => void go(s)}>
                {t(`adm.shop.do.${s}` as "adm.shop.do.confirmed")}
              </Button>
            ))}
          </div>
        </>
      )}
      {o.courier_ref && !o.courier && !(canAct && o.next.length > 0) && <p>{t("adm.shop.courierIs", { ref: o.courier_ref })}</p>}
      <CourierBox
        o={o}
        canAct={canAct}
        onBooked={(fresh) => {
          qc.setQueryData(["shop-order", code], fresh);
          void qc.invalidateQueries({ queryKey: ["shop-orders"] });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ couriers */
interface CourierSettingsValue {
  pathao_store: number;
  pathao_store_name: string;
  pathao_delivery: 48 | 12;
  weight: number;
}
type Reply<T> = { ok: true; data: T } | { ok: false; problem: string; status?: number; detail?: string };
interface CourierCheck {
  steadfast: Reply<{ balance: number }>;
  pathao: Reply<{ id: number; name: string; address: string; active: boolean }[]>;
}

/**
 * The couriers: whether each one's keys are on the website, a check that asks each courier (Steadfast's balance, Pathao's stores), the
 * Pathao store parcels are picked up from, Pathao's delivery speed and the usual weight — and the two webhook addresses to give the
 * couriers, with the names of the GitHub secrets they go with.
 */
function CourierSettings() {
  const { t, money, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = can("settings:write");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => adm<{ settings: { courier: CourierSettingsValue } }>("/settings") });
  const setup = useQuery({ queryKey: ["shop-couriers"], queryFn: () => adm<CourierSetup>("/shop/couriers") });
  const [v, setV] = useState<CourierSettingsValue | null>(null);
  const [weightText, setWeightText] = useState("");
  const [result, setResult] = useState<CourierCheck | null>(null);
  useEffect(() => {
    if (settings.data && !v) {
      setV(settings.data.settings.courier);
      setWeightText(String(settings.data.settings.courier.weight));
    }
  }, [settings.data, v]);
  const check = useMutation({
    mutationFn: () => adm<CourierCheck>("/shop/couriers/check", { method: "POST", json: {} }),
    onSuccess: (r) => setResult(r),
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });
  const save = useMutation({
    mutationFn: () => adm("/settings/courier", { method: "PUT", json: v }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["shop-couriers"] });
    },
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });
  if (!v || !setup.data) return null;
  const said = (r: Reply<unknown>) => (r.ok ? "" : `${t(`adm.shop.cr.err.${r.problem}` as "adm.shop.cr.err.refused")}${r.detail ? ` — “${r.detail}”` : ""}`);
  const stores = result?.pathao.ok ? result.pathao.data.filter((x) => x.active || x.id === v.pathao_store) : [];
  const hook = (c: Courier) => `${window.location.origin}/api/courier/${c}`;
  return (
    <section className="panel stack mt" aria-labelledby="cr-h">
      <h2 id="cr-h">{t("adm.shop.cr.settings")}</h2>
      <p className="hint">{t("adm.shop.cr.settingsHint")}</p>
      <ul className="plain-list">
        {(["steadfast", "pathao"] as const).map((c) => (
          <li key={c} className="row">
            <b>{COURIER_NAME[c]}</b>
            <Chip tone={setup.data[c] ? "ok" : "neutral"}>{setup.data[c] ? t("adm.shop.cr.keysIn") : t("adm.shop.cr.keysOut")}</Chip>
            <code>{hook(c)}</code>
          </li>
        ))}
      </ul>
      <p className="hint">{t("adm.shop.cr.secrets")}</p>
      {canWrite && (
        <div className="row">
          <Button className="btn-outline" busy={check.isPending} onClick={() => check.mutate()}>
            {t("adm.shop.cr.check")}
          </Button>
        </div>
      )}
      {result && (
        <ul className="plain-list" role="status">
          <li>
            <b>Steadfast:</b> {result.steadfast.ok ? t("adm.shop.cr.balance", { amount: money(result.steadfast.data.balance) }) : said(result.steadfast)}
          </li>
          <li>
            <b>Pathao:</b> {result.pathao.ok ? t("adm.shop.cr.stores", { n: String(result.pathao.data.length) }) : said(result.pathao)}
          </li>
        </ul>
      )}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field id="cr-store" label={t("adm.shop.cr.store")} hint={stores.length ? t("adm.shop.cr.storeHint") : t("adm.shop.cr.storeFirst")}>
          <select
            id="cr-store"
            className="input"
            value={v.pathao_store ? String(v.pathao_store) : ""}
            disabled={!canWrite || !stores.length}
            onChange={(e) => {
              const id = Number(e.target.value);
              setV({ ...v, pathao_store: id, pathao_store_name: stores.find((x) => x.id === id)?.name ?? "" });
            }}
          >
            {/* the chosen store keeps its own option (its name) until "Check the couriers" lists the stores again */}
            {!v.pathao_store && <option value="">{t("adm.shop.cr.storeNone")}</option>}
            {v.pathao_store > 0 && !stores.some((x) => x.id === v.pathao_store) && <option value={v.pathao_store}>{v.pathao_store_name || v.pathao_store}</option>}
            {stores.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} — {x.address}
              </option>
            ))}
          </select>
        </Field>
        <Field id="cr-speed" label={t("adm.shop.cr.speed")}>
          <select id="cr-speed" className="input" value={v.pathao_delivery} disabled={!canWrite} onChange={(e) => setV({ ...v, pathao_delivery: Number(e.target.value) === 12 ? 12 : 48 })}>
            <option value={48}>{t("adm.shop.cr.speed48")}</option>
            <option value={12}>{t("adm.shop.cr.speed12")}</option>
          </select>
        </Field>
        <Field id="cr-kg" label={t("adm.shop.cr.weightDefault")} hint={t("adm.shop.cr.weightDefaultHint")}>
          <TextInput
            id="cr-kg"
            inputMode="decimal"
            value={weightText}
            disabled={!canWrite}
            onChange={(e) => {
              const text = fromBnDigits(e.target.value).replace(",", ".").replace(/[^\d.]/g, "");
              setWeightText(text);
              setV({ ...v, weight: Math.min(10, Math.max(0.5, Math.round((Number(text) || 0.5) * 10) / 10)) });
            }}
          />
        </Field>
        {canWrite && (
          <div className="row">
            <Button type="submit" busy={save.isPending}>
              {t("btn.save")}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------------------------- reviews */
interface ReviewRow {
  id: number;
  name: string;
  rating: number;
  body: string;
  verified: number;
  status: "pending" | "approved" | "hidden";
  created_at: string;
  product_en: string;
  product_bn: string;
  product_slug: string;
}

function Reviews() {
  const { t, date, lang } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"pending" | "approved" | "hidden">("pending");
  const list = useQuery({ queryKey: ["shop-reviews", status], queryFn: () => adm<{ items: ReviewRow[] }>(`/shop/reviews?status=${status}`) });
  const set = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "hidden" }) => adm(`/shop/reviews/${v.id}`, { json: { status: v.status } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["shop-reviews"] });
    },
  });
  return (
    <>
      <PageHeader title={t("adm.shop.tab.reviews")} sub={t("adm.shop.reviews.sub")} />
      <Tabs value={status} onChange={setStatus} tabs={(["pending", "approved", "hidden"] as const).map((s) => ({ value: s, label: t(`adm.shop.rv.${s}` as "adm.shop.rv.pending") }))} />
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Empty icon="star" title={t("adm.shop.noReviews")} />
      ) : (
        <ul className="stack plain">
          {list.data.items.map((r) => (
            <li key={r.id} className="panel">
              <div className="row">
                <b>{"★".repeat(r.rating)}</b>
                <span>{r.name}</span>
                {!!r.verified && <Chip tone="ok">{t("adm.shop.verified")}</Chip>}
                <span className="muted small">
                  {lang === "bn" ? r.product_bn : r.product_en} · {date(r.created_at)}
                </span>
              </div>
              <p>{r.body}</p>
              {can("shop:reviews") && (
                <div className="row">
                  {r.status !== "approved" && (
                    <Button className="btn-primary btn-sm" onClick={() => set.mutate({ id: r.id, status: "approved" })}>
                      {t("adm.shop.approve")}
                    </Button>
                  )}
                  {r.status !== "hidden" && (
                    <Button className="btn-ghost btn-sm" onClick={() => set.mutate({ id: r.id, status: "hidden" })}>
                      {t("adm.shop.hide")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ settings */
interface Store {
  enabled: boolean;
  cod: boolean;
  online: boolean;
  home_district: number;
  fee_home: number;
  fee_other: number;
  free_over: number;
  free_delivery: boolean;
  free_until: string;
  cod_charge: boolean;
  cod_pct: number;
  cod_min: number;
  delivery_bn: string;
  delivery_en: string;
}

/** Today in Bangladesh, as the offer's last day is written (YYYY-MM-DD). */
const dhakaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

function StoreSettings() {
  const { t, lang, err, money, date } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = can("settings:write");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => adm<{ settings: { store: Store } }>("/settings") });
  const districts = useQuery({ queryKey: ["geo-all-districts"], queryFn: async () => (await api<{ items: { id: number; name_en: string; name_bn: string }[] }>("/shop/geo/districts")).items, staleTime: Infinity });
  const [v, setV] = useState<Store | null>(null);
  // the offer's "who gets it" and the charge's percent as typed ("1." on the way to "1.5"): the form's own, turned into numbers on the way
  const [freeFrom, setFreeFrom] = useState(false);
  const [pctText, setPctText] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings.data && !v) {
      const s = settings.data.settings.store;
      setV(s);
      setFreeFrom(s.free_over > 0);
      setPctText(String(s.cod_pct));
    }
  }, [settings.data, v]);
  const save = useMutation({
    mutationFn: () => adm(`/settings/store`, { method: "PUT", json: { ...v!, free_over: freeFrom ? v!.free_over : 0 } }),
    onSuccess: () => {
      setFields({});
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) {
        setFields(Object.fromEntries(Object.entries(e.fields).map(([k, c]) => [k, c === "required" ? t("err.required") : c === "store_no_payment" ? t("adm.shop.needPayment") : err(c)])));
      } else toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  if (settings.isPending || !v) return <Spinner />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  const set = <K extends keyof Store>(k: K, val: Store[K]) => setV({ ...v, [k]: val });
  const taka = (s: string) => Math.max(0, Math.floor(Number(fromBnDigits(s)) || 0));
  const ended = v.free_delivery && !!v.free_until && v.free_until < dhakaToday();
  const offerState = !v.free_delivery ? { tone: "neutral" as const, label: t("adm.shop.offer.inactive") } : ended ? { tone: "warn" as const, label: t("adm.shop.offer.ended", { date: date(v.free_until) }) } : { tone: "ok" as const, label: t("adm.shop.offer.active") };
  const offerText = () => {
    const what = freeFrom && v.free_over > 0 ? t("adm.shop.freeText.from", { amount: money(v.free_over) }) : t("adm.shop.freeText.all");
    return v.free_until ? `${what} · ${t("adm.shop.freeText.until", { date: date(v.free_until) })}` : what;
  };
  // the charge on an everyday order, worked out the way the checkout does (shared/src/shop.ts)
  const example = { goods: 1000, delivery: v.fee_other || 120 };
  const exampleFee = codCharge(example.goods + example.delivery, v.cod_pct, v.cod_min);
  return (
    <>
      <PageHeader title={t("adm.shop.tab.settings")} sub={t("adm.shop.settings.sub")} />
      {/* named, since the couriers' card below it has a Save of its own */}
      <form
        className="panel stack"
        aria-label={t("adm.shop.tab.settings")}
        onSubmit={(e) => {
          e.preventDefault();
          if (v.free_delivery && freeFrom && v.free_over <= 0) {
            setFields({ free_over: t("err.required") });
            document.getElementById("st-free-over")?.focus();
            return;
          }
          save.mutate();
        }}
      >
        <Switch id="st-enabled" label={t("adm.shop.open")} checked={v.enabled} disabled={!canWrite} onChange={(x) => set("enabled", x)} />
        <p className="hint">{t("adm.shop.openHint")}</p>
        <fieldset className="stack plain-fieldset">
          <legend>{t("adm.shop.payWays")}</legend>
          <Switch id="st-cod" label={t("adm.shop.cod")} checked={v.cod} disabled={!canWrite} onChange={(x) => set("cod", x)} />
          <Switch id="st-online" label={t("adm.shop.onlineSsl")} checked={v.online} disabled={!canWrite} onChange={(x) => set("online", x)} />
          {fields.cod && <p className="err-text">{fields.cod}</p>}
        </fieldset>
        <fieldset className="form-grid plain-fieldset">
          <legend>{t("adm.shop.deliveryCharges")}</legend>
          <Field id="st-home" label={t("adm.shop.homeDistrict")} hint={t("adm.shop.homeHint")}>
            <select id="st-home" className="input" value={v.home_district} disabled={!canWrite} onChange={(e) => set("home_district", Number(e.target.value))}>
              {(districts.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {lang === "bn" ? d.name_bn : d.name_en}
                </option>
              ))}
            </select>
          </Field>
          <Field id="st-fee-home" label={t("adm.shop.feeHome")} error={fields.fee_home}>
            <TextInput id="st-fee-home" inputMode="numeric" value={v.fee_home || ""} disabled={!canWrite} error={fields.fee_home} onChange={(e) => set("fee_home", taka(e.target.value))} />
          </Field>
          <Field id="st-fee-other" label={t("adm.shop.feeOther")} error={fields.fee_other}>
            <TextInput id="st-fee-other" inputMode="numeric" value={v.fee_other || ""} disabled={!canWrite} error={fields.fee_other} onChange={(e) => set("fee_other", taka(e.target.value))} />
          </Field>
          <Field id="st-dl-bn" label={t("adm.shop.deliveryBn")} hint={t("adm.shop.deliveryHint")}>
            <TextInput id="st-dl-bn" value={v.delivery_bn} maxLength={200} disabled={!canWrite} onChange={(e) => set("delivery_bn", e.target.value)} />
          </Field>
          <Field id="st-dl-en" label={t("adm.shop.deliveryEn")}>
            <TextInput id="st-dl-en" value={v.delivery_en} maxLength={200} disabled={!canWrite} onChange={(e) => set("delivery_en", e.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="stack plain-fieldset offer-box">
          <legend>{t("adm.shop.freeOffer")}</legend>
          <div className="row">
            <Switch id="st-free" label={t("adm.shop.freeOn")} checked={v.free_delivery} disabled={!canWrite} onChange={(x) => set("free_delivery", x)} />
            <Chip tone={offerState.tone}>{offerState.label}</Chip>
          </div>
          <p className="hint">{t("adm.shop.freeHint")}</p>
          {v.free_delivery && (
            <>
              <fieldset className="plain-fieldset">
                <legend>{t("adm.shop.freeWho")}</legend>
                <label className="check">
                  <input type="radio" name="st-free-who" checked={!freeFrom} disabled={!canWrite} onChange={() => setFreeFrom(false)} /> {t("adm.shop.freeAll")}
                </label>
                <label className="check">
                  <input type="radio" name="st-free-who" checked={freeFrom} disabled={!canWrite} onChange={() => setFreeFrom(true)} /> {t("adm.shop.freeFrom")}
                </label>
              </fieldset>
              <div className="form-grid">
                {freeFrom && (
                  <Field id="st-free-over" label={t("adm.shop.freeOver")} error={fields.free_over}>
                    <TextInput id="st-free-over" inputMode="numeric" value={v.free_over || ""} disabled={!canWrite} error={fields.free_over} onChange={(e) => set("free_over", taka(e.target.value))} />
                  </Field>
                )}
                <Field id="st-free-until" label={t("adm.shop.freeUntil")} hint={t("adm.shop.freeUntilHint")} error={fields.free_until}>
                  <TextInput id="st-free-until" type="date" value={v.free_until} disabled={!canWrite} error={fields.free_until} onChange={(e) => set("free_until", e.target.value)} />
                </Field>
              </div>
              <p className="hint">{t("adm.shop.freePreview", { text: offerText() })}</p>
            </>
          )}
        </fieldset>

        <fieldset className="stack plain-fieldset offer-box">
          <legend>{t("adm.shop.codCharge")}</legend>
          <div className="row">
            <Switch id="st-cod-charge" label={t("adm.shop.codChargeOn")} checked={v.cod_charge} disabled={!canWrite || !v.cod} onChange={(x) => set("cod_charge", x)} />
            <Chip tone={v.cod && v.cod_charge ? "ok" : "neutral"}>{v.cod && v.cod_charge ? t("adm.shop.offer.active") : t("adm.shop.offer.inactive")}</Chip>
          </div>
          <p className="hint">{v.cod ? t("adm.shop.codChargeHint") : t("adm.shop.codNeedsCod")}</p>
          {v.cod && v.cod_charge && (
            <>
              <div className="form-grid">
                <Field id="st-cod-pct" label={t("adm.shop.codPct")} hint={t("adm.shop.codPctHint")} error={fields.cod_pct}>
                  <TextInput
                    id="st-cod-pct"
                    inputMode="decimal"
                    value={pctText}
                    disabled={!canWrite}
                    error={fields.cod_pct}
                    onChange={(e) => {
                      const text = fromBnDigits(e.target.value).replace(",", ".").replace(/[^\d.]/g, "");
                      setPctText(text);
                      set("cod_pct", Math.min(10, Math.round((Number(text) || 0) * 10) / 10));
                    }}
                  />
                </Field>
                <Field id="st-cod-min" label={t("adm.shop.codMin")}>
                  <TextInput id="st-cod-min" inputMode="numeric" value={v.cod_min || ""} disabled={!canWrite} onChange={(e) => set("cod_min", Math.min(1000, taka(e.target.value)))} />
                </Field>
              </div>
              <p className="hint">{t("adm.shop.codExample", { goods: money(example.goods), delivery: money(example.delivery), fee: money(exampleFee) })}</p>
            </>
          )}
        </fieldset>
        <p className="hint">{t("adm.shop.policiesHint")}</p>
        {canWrite ? (
          <div className="row">
            <Button type="submit" busy={save.isPending}>
              {t("btn.save")}
            </Button>
            {v.enabled && (
              <a className="btn btn-outline" href="/shop" target="_blank" rel="noopener noreferrer">
                {t("adm.shop.view")}
              </a>
            )}
          </div>
        ) : (
          <p className="hint">{t("adm.pay.chk.readonly")}</p>
        )}
      </form>
    </>
  );
}
