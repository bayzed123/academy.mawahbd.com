import { useI18n } from "../lib/i18n";
import { Chip, StatusChip } from "./ui";

/** A class's state in the owner's words: Active (on the website) or Inactive (hidden); Coming soon and Archived keep their own names. */
export function CourseStateChip({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "published") return <Chip tone="ok">{t("adm.course.active")}</Chip>;
  if (status === "draft") return <Chip tone="neutral">{t("adm.course.inactive")}</Chip>;
  return <StatusChip status={status} />;
}
