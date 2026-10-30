import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Permission } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { DataTable, type Column, type FilterDef } from "./DataTable";
import { FormFields, initialValues, toPayload, type FieldDef, type Values } from "./Form";
import { Button, IconButton, PageHeader, SlideOver, useConfirm, useFieldErrors, useToast } from "./ui";

interface Props<T extends { id: number }> {
  title: string;
  sub?: string;
  endpoint: string;
  perms: { write: Permission; delete?: Permission };
  columns: Column<T>[];
  fields: FieldDef[];
  defaults: Values;
  filters?: FilterDef[];
  searchPlaceholder?: string;
  defaultSort?: string;
  rowLabel: (row: T) => string;
  csv?: boolean;
  /** soft-deleted rows can be listed and restored (instructors, classes, blog …) */
  trash?: boolean;
  wide?: boolean;
  /** extra per-row buttons (e.g. "Open curriculum") */
  rowActions?: (row: T) => ReactNode;
  /** shape the values just before they are sent */
  transform?: (values: Values) => Values;
  /** replace the built-in edit drawer (the class editor is a full page) */
  onEdit?: (row: T | null) => void;
  /** a read-only page for a row: clicking the row opens it, and an eye button appears next to Edit (classes) */
  onView?: (row: T) => void;
  toolbarExtra?: ReactNode;
  /** shown above the form in the edit drawer and redrawn as the values change (banners: how it will look) */
  preview?: (values: Values) => ReactNode;
}

/**
 * One generic "list + create/edit drawer + delete/restore" screen. Instructors, categories, blog posts,
 * bundles, coupons and the class list are all this component with different columns and fields —
 * so every module behaves the same way and a fix lands everywhere at once.
 */
export function ResourcePage<T extends { id: number; deleted_at?: string | null }>({ title, sub, endpoint, perms, columns, fields, defaults, filters, searchPlaceholder, defaultSort, rowLabel, csv = true, trash, wide, rowActions, transform, onEdit, onView, toolbarExtra, preview }: Props<T>) {
  const { t, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const [params, setParams] = useSearchParams();
  const showTrash = params.get("deleted") === "1";
  const [editing, setEditing] = useState<{ row: T | null } | null>(null);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const canWrite = can(perms.write);
  const canDelete = can(perms.delete ?? perms.write);

  const open = (row: T | null) => {
    if (onEdit) return onEdit(row);
    setErrors({});
    setValues(initialValues(fields, row as unknown as Values | null, defaults));
    setEditing({ row });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = toPayload(fields, values);
      const payload = transform ? transform(body) : body;
      return editing?.row ? adm(`${endpoint}/${editing.row.id}`, { method: "PATCH", json: payload }) : adm(endpoint, { method: "POST", json: payload });
    },
    onSuccess: () => {
      toast(t("adm.saved"));
      setEditing(null);
      void qc.invalidateQueries({ queryKey: [endpoint] });
      void qc.invalidateQueries({ queryKey: ["course-options"] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!(e instanceof ApiError && e.code === "validation")) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });

  const remove = async (row: T) => {
    const res = await confirm({ title: t("adm.confirm.delete", { name: rowLabel(row) }), body: t("adm.confirm.deleteBody"), danger: true, confirmLabel: t("btn.delete") });
    if (!res.ok) return;
    try {
      await adm(`${endpoint}/${row.id}`, { method: "DELETE" });
      toast(t("adm.deleted"));
      void qc.invalidateQueries({ queryKey: [endpoint] });
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    }
  };
  const restore = async (row: T) => {
    try {
      await adm(`${endpoint}/${row.id}/restore`, { method: "POST", json: {} });
      toast(t("adm.restored"));
      void qc.invalidateQueries({ queryKey: [endpoint] });
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    }
  };

  // the form's live preview (a banner as visitors will see it, a video's player …); nothing to show, no empty box above the form
  const pv = preview?.(values);
  return (
    <>
      <PageHeader
        title={title}
        sub={sub}
        actions={
          canWrite && (
            <Button className="btn-primary" onClick={() => open(null)}>
              + {t("btn.add")}
            </Button>
          )
        }
      />
      <DataTable<T>
        endpoint={endpoint}
        columns={columns}
        filters={filters}
        searchPlaceholder={searchPlaceholder}
        defaultSort={defaultSort}
        csv={csv}
        extraParams={{ deleted: showTrash ? "1" : undefined }}
        onRowClick={onView ? (row) => !showTrash && onView(row) : canWrite ? (row) => !showTrash && open(row) : undefined}
        toolbar={
          <>
            {trash && (
              <Button
                className={showTrash ? "btn-outline on" : "btn-outline"}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (showTrash) next.delete("deleted");
                  else next.set("deleted", "1");
                  next.delete("page");
                  setParams(next);
                }}
              >
                {t("adm.trash")}
              </Button>
            )}
            {toolbarExtra}
          </>
        }
        rowActions={(row) => (
          <div className="row nowrap">
            {rowActions?.(row)}
            {showTrash ? (
              canDelete && (
                <Button className="btn-outline" onClick={() => restore(row)}>
                  {t("adm.restore")}
                </Button>
              )
            ) : (
              <>
                {onView && <IconButton icon="eye" label={t("adm.view")} onClick={() => onView(row)} />}
                {canWrite && <IconButton icon="sparkle" label={t("btn.edit")} onClick={() => open(row)} />}
                {canDelete && <IconButton icon="x" label={t("btn.delete")} onClick={() => remove(row)} />}
              </>
            )}
          </div>
        )}
      />
      <SlideOver
        open={!!editing}
        wide={wide}
        onClose={() => setEditing(null)}
        title={editing?.row ? `${t("btn.edit")}: ${rowLabel(editing.row)}` : t("adm.new", { what: title })}
        footer={
          <div className="row end">
            <Button className="btn-ghost" onClick={() => setEditing(null)}>
              {t("btn.cancel")}
            </Button>
            <Button className="btn-primary" busy={save.isPending} onClick={() => save.mutate()}>
              {t("btn.save")}
            </Button>
          </div>
        }
      >
        {pv != null && <div className="pv-sticky">{pv}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          noValidate
        >
          <FormFields fields={fields} values={values} errors={errors} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} idPrefix={`r-${endpoint.slice(1)}`} />
        </form>
      </SlideOver>
    </>
  );
}
