import type { CertificateDTO, CourseCardDTO, CurriculumModuleDTO, LessonContentDTO, MyCourseDTO, Progress } from "@mawah/shared/types";
import type { MaterialKind } from "@mawah/shared/constants";
import type { ShopCardDTO, ShopCategoryDTO, ShopProductDTO } from "@mawah/shared/shop";

/** What the website's API answers (worker/src/routes/api/*), as far as the app reads it. */
export interface SiteInfo {
  site: {
    contact: { whatsapp: string; phone: string; email: string; facebook: string; messenger: string };
    /** the notice at the top of Home (Admin → Android app); null when switched off. Older servers do not send it. */
    app_notice?: { bn: string; en: string } | null;
  };
}
export interface CourseList {
  courses: CourseCardDTO[];
  total: number;
}
export interface PublicCourse {
  course: CourseCardDTO & { long_bn: string; long_en: string; demo_url: string; demo_title_bn: string; demo_title_en: string };
  curriculum: CurriculumModuleDTO[];
}
/** One of the app's free classes (GET /api/app/courses/:slug): `joined` once it is the student's; `revoked` when staff took it back. */
export interface FreeClass {
  course: PublicCourse["course"] & { instructor: { name_bn: string; name_en: string } | null };
  curriculum: CurriculumModuleDTO[];
  joined: boolean;
  revoked: boolean;
}
export interface MyCourses {
  courses: MyCourseDTO[];
}
export interface StudentCourse {
  course: CourseCardDTO;
  progress: Progress;
  curriculum: CurriculumModuleDTO[];
  certificate: CertificateDTO | null;
}
export interface LessonAnswer {
  lesson: LessonContentDTO;
}
export interface Completed {
  progress: Progress;
  certificate: CertificateDTO | null;
}
export interface Certificates {
  certificates: CertificateDTO[];
}
export interface ShopPage {
  items: ShopCardDTO[];
  total: number;
  page: number;
  pages: number;
}
export interface ShopCategories {
  items: ShopCategoryDTO[];
}
export interface ShopProduct {
  product: ShopProductDTO;
}
export type { MaterialKind };
export interface StudentMaterial {
  id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  delivery: "file" | "link" | "play" | "pending" | "embed";
  media_url: string | null;
  filename: string | null;
  size_bytes: number | null;
  platform: string | null;
  starts_at: string | null;
  duration_min: number | null;
  ask_profile: boolean;
  request: { status: "pending" | "approved" | "rejected" } | null;
}
export interface Materials {
  materials: StudentMaterial[];
}
