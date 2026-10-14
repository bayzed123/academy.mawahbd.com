import { Link } from "react-router";
import { Empty } from "../components/ui";
import { useI18n } from "../lib/i18n";

export function NotFound() {
  const { t } = useI18n();
  return (
    <Empty icon="search" title={t("app.notFound.title")}>
      <p>{t("app.notFound.body")}</p>
      <Link className="btn btn-primary" to="/">
        {t("app.nav.learning")}
      </Link>
    </Empty>
  );
}
