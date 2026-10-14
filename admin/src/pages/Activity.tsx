import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { DataTable } from "../components/DataTable";
import { Chip, PageHeader } from "../components/ui";

interface Entry {
  id: number;
  actor_type: "staff" | "student" | "system";
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string;
  summary: string;
  meta: string;
  ip: string;
  created_at: string;
}

export function Activity() {
  const { t, dateTime } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <PageHeader title={t("adm.nav.activity")} sub={t("adm.activity.sub")} />
      <DataTable<Entry>
        endpoint="/activity"
        csv
        dateRange
        perPage={40}
        searchPlaceholder={t("adm.activity.search")}
        filters={[{ key: "actor_type", label: t("adm.activity.actor"), options: ["staff", "student", "system"].map((a) => ({ value: a, label: t(`adm.actor.${a}` as "adm.actor.staff") })) }]}
        onRowClick={(r) => setOpen(open === r.id ? null : r.id)}
        columns={[
          { key: "time", label: t("label.date"), render: (r) => <span className="nowrap">{dateTime(r.created_at)}</span> },
          { key: "actor", label: t("adm.activity.actor"), render: (r) => (<span className="cell-title"><b>{r.actor_name || t(`adm.actor.${r.actor_type}` as "adm.actor.system")}</b><small>{t(`adm.actor.${r.actor_type}` as "adm.actor.staff")}</small></span>) },
          {
            key: "action",
            label: t("adm.activity.action"),
            render: (r) => (
              <span className="cell-title">
                <code className="code">{r.action}</code>
                {r.summary && <small>{r.summary}</small>}
                {open === r.id && <pre className="meta">{JSON.stringify({ entity: r.entity, id: r.entity_id, ip: r.ip, ...safe(r.meta) }, null, 2)}</pre>}
              </span>
            ),
          },
          { key: "entity", label: t("adm.activity.entity"), desktopOnly: true, render: (r) => (r.entity ? <Chip>{r.entity}</Chip> : "—") },
        ]}
      />
    </>
  );
}

function safe(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}
