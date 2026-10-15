import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MATERIAL_KINDS } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { DataTable } from "../components/DataTable";
import { KIND_ICON, MaterialDrawer, sizeLabel, type Material } from "../components/MaterialDrawer";
import { ResourcePage } from "../components/ResourcePage";
import { Button, Chip, Icon, PageHeader, Switch, useToast } from "../components/ui";
import { useCourseOptions } from "./Courses";

/** The on/off switch in the list: shown to students / hidden, without opening the form. */
function ShownToggle({ row, canWrite }: { row: Material; canWrite: boolean }) {
  const { t, pick, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const name = pick(row, "title") || t("adm.mat.untitled");
  const flip = useMutation({
    mutationFn: (active: boolean) => adm(`/materials/${row.id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/materials"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  return <Switch checked={!!row.active} disabled={!canWrite || flip.isPending} onChange={(x) => flip.mutate(x)} label={t("adm.mat.toggle", { name })} hideLabel />;
}

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/** Admin → Materials: every file, link, live class and private group of every class, in one table. */
export function Materials() {
  const { t, pick, dateTime } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const classes = useCourseOptions();
  const canWrite = can("materials:write");
  const [editing, setEditing] = useState<{ row: Material | null } | null>(null);
  const fromClass = params.get("course_id") ?? undefined;

  // arriving from a class ("Add material" on its overview) opens the form for that class straight away
  useEffect(() => {
    if (params.get("add") === "1" && canWrite) {
      setEditing({ row: null });
      const next = new URLSearchParams(params);
      next.delete("add");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kindLabel = (k: string) => t(`adm.mat.kind.${k}` as "adm.mat.kind.pdf");
  const requests = useQuery({ queryKey: ["group-requests-waiting"], queryFn: () => adm<{ page: { total: number } }>("/group-requests?status=pending&per_page=1"), staleTime: 30_000 });
  const waiting = requests.data?.page?.total ?? 0;

  return (
    <>
      <ResourcePage<Material>
        title={t("adm.nav.materials")}
        sub={t("adm.mat.sub")}
        endpoint="/materials"
        perms={{ write: "materials:write" }}
        fields={[]}
        defaults={{}}
        onEdit={(row) => setEditing({ row })}
        rowLabel={(r) => r.title_en || r.title_bn || `#${r.id}`}
        defaultSort="-id"
        searchPlaceholder={t("adm.mat.search")}
        trash
        filters={[
          { key: "course_id", label: t("adm.mat.col.class"), options: classes },
          { key: "kind", label: t("adm.mat.col.type"), options: MATERIAL_KINDS.map((k) => ({ value: k, label: kindLabel(k) })) },
          { key: "active", label: t("label.status"), options: [{ value: "1", label: t("adm.mat.status.on") }, { value: "0", label: t("adm.mat.status.off") }] },
        ]}
        toolbarExtra={
          <>
            <Link className="btn btn-outline btn-sm" to="/materials/requests">
              <Icon name="users" /> {t("adm.mat.requests")}
              {waiting > 0 && <Chip tone="warn">{t("adm.mat.waiting", { n: waiting })}</Chip>}
            </Link>
            <Link className="btn btn-outline btn-sm" to="/materials/downloads">
              <Icon name="download" /> {t("adm.mat.downloads")}
            </Link>
          </>
        }
        columns={[
          {
            key: "title",
            label: t("adm.mat.col.title"),
            render: (r) => (
              <span className="cell-icon">
                <span className="kind-ico" aria-hidden="true">
                  <Icon name={KIND_ICON[r.kind]} />
                </span>
                <span className="cell-title">
                  <b>{pick(r, "title") || t("adm.mat.untitled")}</b>
                  <small>{kindLabel(r.kind)}</small>
                </span>
              </span>
            ),
          },
          { key: "class", label: t("adm.mat.col.class"), desktopOnly: true, render: (r) => pick({ a_bn: r.course_title_bn ?? "", a_en: r.course_title_en ?? "" }, "a") || `#${r.course_id}` },
          {
            key: "delivery",
            label: t("adm.mat.col.delivery"),
            desktopOnly: true,
            render: (r) =>
              r.r2_key ? (
                <span className="cell-title">
                  <b>{r.filename}</b>
                  <small>{sizeLabel(r.size_bytes)}</small>
                </span>
              ) : r.kind === "live" && r.starts_at ? (
                <span className="cell-title">
                  <b>{dateTime(r.starts_at)}</b>
                  <small>{host(r.url)}</small>
                </span>
              ) : (
                <span className="cell-title">
                  <b>{host(r.url)}</b>
                  <small>{r.kind === "group" && r.ask_profile ? t("adm.mat.asksProfile") : ""}</small>
                </span>
              ),
          },
          {
            key: "downloads",
            label: t("adm.mat.col.downloads"),
            desktopOnly: true,
            render: (r) => (
              <span className="row nowrap">
                {r.downloads ?? 0}
                {!!r.pending_requests && (
                  <Link to={`/materials/requests?material_id=${r.id}&status=pending`} onClick={(e) => e.stopPropagation()}>
                    <Chip tone="warn">{t("adm.mat.waiting", { n: r.pending_requests })}</Chip>
                  </Link>
                )}
              </span>
            ),
          },
          // on a phone the switch beside it already says shown / hidden
          { key: "status", label: t("label.status"), desktopOnly: true, render: (r) => <Chip tone={r.active ? "ok" : "neutral"}>{t(r.active ? "adm.mat.status.on" : "adm.mat.status.off")}</Chip> },
        ]}
        rowActions={(r) => (
          <>
            {r.r2_key && (
              <a className="icon-btn desk-i" href={`/api/admin/materials/${r.id}/file`} aria-label={t("adm.mat.openFile")} onClick={(e) => e.stopPropagation()}>
                <Icon name="download" />
              </a>
            )}
            <ShownToggle row={r} canWrite={canWrite} />
          </>
        )}
      />
      <MaterialDrawer open={!!editing} row={editing?.row ?? null} courseId={fromClass} classes={classes} onClose={() => setEditing(null)} />
    </>
  );
}

/* --------------------------------------------------------------------------------------- who asked to join a group */
interface GroupRequest {
  id: number;
  status: "pending" | "approved" | "rejected";
  profile_url: string;
  note: string;
  created_at: string;
  handled_at: string | null;
  handled_by_name: string | null;
  student_name: string;
  student_email: string;
  student_phone: string | null;
  material_title_bn: string;
  material_title_en: string;
  course_title_bn: string;
  course_title_en: string;
  group_url: string;
}

function AnswerButtons({ row }: { row: GroupRequest }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const answer = useMutation({
    mutationFn: (status: GroupRequest["status"]) => adm(`/group-requests/${row.id}`, { method: "PATCH", json: { status, note: row.note } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/group-requests"] });
      void qc.invalidateQueries({ queryKey: ["group-requests-waiting"] });
      void qc.invalidateQueries({ queryKey: ["/materials"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  if (!can("materials:write")) return null;
  return (
    <span className="row nowrap">
      {row.status !== "approved" && (
        <Button className="btn-outline btn-sm" busy={answer.isPending} onClick={() => answer.mutate("approved")}>
          <Icon name="check" /> {t("adm.mat.reqs.approve")}
        </Button>
      )}
      {row.status !== "rejected" && (
        <Button className="btn-ghost btn-sm" busy={answer.isPending} onClick={() => answer.mutate("rejected")}>
          {t("adm.mat.reqs.decline")}
        </Button>
      )}
    </span>
  );
}

export function GroupRequests() {
  const { t, pick, dateTime } = useI18n();
  const [params] = useSearchParams();
  const statusTone = { pending: "warn", approved: "ok", rejected: "neutral" } as const;
  return (
    <>
      <PageHeader
        title={t("adm.mat.reqs.title")}
        sub={t("adm.mat.reqs.sub")}
        back={
          <Link className="btn btn-ghost btn-sm" to="/materials">
            {t("adm.mat.back")}
          </Link>
        }
      />
      <DataTable<GroupRequest>
        endpoint="/group-requests"
        csv
        searchPlaceholder={t("adm.mat.reqs.search")}
        emptyTitle={t("adm.mat.reqs.empty")}
        extraParams={{ material_id: params.get("material_id") ?? undefined }}
        filters={[{ key: "status", label: t("label.status"), options: (["pending", "approved", "rejected"] as const).map((s) => ({ value: s, label: t(`adm.mat.reqs.status.${s}` as "adm.mat.reqs.status.pending") })) }]}
        columns={[
          {
            key: "student",
            label: t("adm.mat.reqs.student"),
            render: (r) => (
              <span className="cell-title">
                <b>{r.student_name}</b>
                <small>{[r.student_email, r.student_phone].filter(Boolean).join(" · ")}</small>
              </span>
            ),
          },
          {
            key: "profile",
            label: t("adm.mat.reqs.profile"),
            render: (r) =>
              r.profile_url ? (
                <a href={r.profile_url} target="_blank" rel="noopener noreferrer" className="ext-link">
                  {t("adm.mat.reqs.openProfile")} <Icon name="external" />
                </a>
              ) : (
                "—"
              ),
          },
          {
            key: "group",
            label: t("adm.mat.reqs.group"),
            desktopOnly: true,
            render: (r) => (
              <span className="cell-title">
                <b>{pick({ a_bn: r.material_title_bn, a_en: r.material_title_en }, "a")}</b>
                <small>{pick({ a_bn: r.course_title_bn, a_en: r.course_title_en }, "a")}</small>
              </span>
            ),
          },
          { key: "when", label: t("adm.mat.reqs.when"), desktopOnly: true, render: (r) => dateTime(r.created_at) },
          { key: "status", label: t("label.status"), render: (r) => <Chip tone={statusTone[r.status]}>{t(`adm.mat.reqs.status.${r.status}` as "adm.mat.reqs.status.pending")}</Chip> },
        ]}
        rowActions={(r) => <AnswerButtons row={r} />}
      />
    </>
  );
}

/* ---------------------------------------------------------------------------------------- who downloaded what */
interface DownloadRow {
  id: number;
  action: "download" | "open";
  created_at: string;
  kind: string;
  student_name: string;
  student_email: string;
  material_title_bn: string;
  material_title_en: string;
  course_title_bn: string;
  course_title_en: string;
}

export function MaterialDownloads() {
  const { t, pick, dateTime } = useI18n();
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader
        title={t("adm.mat.dl.title")}
        sub={t("adm.mat.dl.sub")}
        back={
          <Link className="btn btn-ghost btn-sm" to="/materials">
            {t("adm.mat.back")}
          </Link>
        }
      />
      <DataTable<DownloadRow>
        endpoint="/material-downloads"
        csv
        searchPlaceholder={t("adm.mat.dl.search")}
        extraParams={{ material_id: params.get("material_id") ?? undefined }}
        columns={[
          { key: "when", label: t("adm.mat.dl.when"), render: (r) => dateTime(r.created_at) },
          {
            key: "student",
            label: t("adm.mat.dl.student"),
            render: (r) => (
              <span className="cell-title">
                <b>{r.student_name}</b>
                <small>{r.student_email}</small>
              </span>
            ),
          },
          {
            key: "material",
            label: t("adm.mat.dl.material"),
            render: (r) => (
              <span className="cell-title">
                <b>{pick({ a_bn: r.material_title_bn, a_en: r.material_title_en }, "a")}</b>
                <small>{t(`adm.mat.kind.${r.kind}` as "adm.mat.kind.pdf")}</small>
              </span>
            ),
          },
          { key: "class", label: t("adm.mat.col.class"), desktopOnly: true, render: (r) => pick({ a_bn: r.course_title_bn, a_en: r.course_title_en }, "a") },
          { key: "action", label: t("adm.mat.dl.action"), render: (r) => <Chip tone={r.action === "download" ? "info" : "neutral"}>{t(`adm.mat.dl.action.${r.action}` as "adm.mat.dl.action.open")}</Chip> },
        ]}
      />
    </>
  );
}
