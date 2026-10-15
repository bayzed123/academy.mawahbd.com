import { useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "./api";
import { useI18n } from "./i18n";
import type { CourseRow } from "./types";
import { useConfirm, useToast } from "../components/ui";

/**
 * Active = the class is on the website and open for enrolment (status "published"). Everything else — draft, coming soon,
 * archived — is not Active. One switch, everywhere: the class list, the class's View page and the editor all behave the same.
 */
export const isActive = (c: { status: string }) => c.status === "published";

type Subject = Pick<CourseRow, "id" | "status" | "lesson_count" | "title_bn" | "title_en"> & { enrolled_count?: number; notify_count?: number };

/**
 * Returns `setActive(class, wantActive)`: asks the owner only the questions that matter, saves, and refreshes every screen that
 * shows the class. Resolves true when the change was made.
 *  - turning OFF always asks: the class disappears and nobody can buy it (students who already paid keep their access — the
 *    message says how many)
 *  - turning ON asks only when something deserves a second look: no lessons yet, or people waiting to be told
 */
export function useSetActive() {
  const { t, pick, err, num } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  return async (c: Subject, wantActive: boolean): Promise<boolean> => {
    const name = pick(c, "title");
    if (wantActive) {
      const notes: string[] = [];
      if (c.lesson_count === 0) notes.push(t("adm.course.confirmOn.empty"));
      if ((c.notify_count ?? 0) > 0) notes.push(t(c.notify_count === 1 ? "adm.course.confirmOn.waitingOne" : "adm.course.confirmOn.waiting", { n: num(c.notify_count ?? 0) }));
      if (notes.length) {
        const res = await confirm({ title: t("adm.course.confirmOn.title", { name }), body: notes.join(" "), confirmLabel: t("adm.course.makeActive") });
        if (!res.ok) return false;
      }
    } else {
      const enrolled = c.enrolled_count ?? 0;
      const res = await confirm({
        title: t("adm.course.confirmOff.title", { name }),
        body: enrolled > 0 ? t("adm.course.confirmOff.enrolled", { n: num(enrolled) }) : t("adm.course.confirmOff.body"),
        confirmLabel: t("adm.course.makeInactive"),
        danger: true,
      });
      if (!res.ok) return false;
    }
    try {
      await adm(`/courses/${c.id}`, { method: "PATCH", json: { status: wantActive ? "published" : "draft" } });
      toast(t(wantActive ? "adm.course.nowActive" : "adm.course.nowInactive", { name }));
      void qc.invalidateQueries({ queryKey: ["/courses"] });
      void qc.invalidateQueries({ queryKey: ["course", c.id] });
      void qc.invalidateQueries({ queryKey: ["course-overview", c.id] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      return true;
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
      return false;
    }
  };
}
