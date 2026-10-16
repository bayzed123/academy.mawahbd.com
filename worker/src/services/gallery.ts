import { MAX_CLASS_PICTURES } from "@mawah/shared";
import type { Env } from "../env";
import { all } from "../lib/db";

/** One extra picture of a class, as the public page needs it. */
export interface GalleryImageDTO {
  id: number;
  image_key: string;
  /** a small copy for the grid (NULL: the large one is used there too) */
  thumb_key: string | null;
  caption_bn: string;
  caption_en: string;
}

/** The class's pictures in the order the owner set (Admin → class → Pictures). Public: only keys under the public image prefixes ever get here. */
export async function galleryFor(env: Env, courseId: number): Promise<GalleryImageDTO[]> {
  return all<GalleryImageDTO>(
    env.DB,
    "SELECT id, image_key, thumb_key, caption_bn, caption_en FROM course_images WHERE course_id = ? ORDER BY sort, id LIMIT ?",
    courseId,
    MAX_CLASS_PICTURES,
  );
}
