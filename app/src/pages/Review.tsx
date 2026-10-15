import { Link, useParams } from "react-router";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { ErrorState, Icon, Spinner } from "../components/ui";
import { ReviewBox, useCourseView } from "./Course";

/**
 * Where the public class page's "Write a review" button leads. Only students enrolled in a class can review it (that keeps every
 * rating honest), so a visitor who is not enrolled gets a friendly explanation and the way to enroll instead of an error.
 */
export function ReviewPage() {
  const { slug = "" } = useParams();
  const { t, lang, pick } = useI18n();
  const q = useCourseView(slug);
  const classPage = `${lang === "en" ? "/en" : ""}/courses/${encodeURIComponent(slug)}`;

  if (q.isPending) return <Spinner />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.code === "not_enrolled") {
      return (
        <div className="empty">
          <Icon name="star" />
          <h1>{t("app.review.title")}</h1>
          <p>{t("app.review.notEnrolled")}</p>
          <div className="row center">
            <Link className="btn btn-primary btn-lg" to={`/checkout?c=${encodeURIComponent(slug)}`}>
              {t("app.review.enrollCta")}
            </Link>
            <a className="btn btn-outline btn-lg" href={classPage}>
              {t("app.review.back")}
            </a>
          </div>
        </div>
      );
    }
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  const v = q.data;
  return (
    <>
      <p className="small">
        <Link className="link" to={`/learn/${slug}`}>
          ← {t("app.review.backToClass")}
        </Link>
      </p>
      <h1>{pick(v.course, "title")}</h1>
      <ReviewBox view={v} slug={slug} />
    </>
  );
}
