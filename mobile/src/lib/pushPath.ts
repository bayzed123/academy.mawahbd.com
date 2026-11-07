/**
 * What a tap on a notification opens. The server puts one of the app's own screens in the notification's data (`path`): the Home, a free
 * class, a website class's free demo, or one of the student's classes. Anything else — a mistake, or a notification the app did not expect —
 * opens nothing, so a notification can never send the app somewhere unknown. (A class's address is made of a–z, 0–9 and dashes.)
 */
const SCREEN = /^\/(?:(?:free|course|demo)\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export function screenOf(path: unknown): string | null {
  return typeof path === "string" && path.length <= 140 && SCREEN.test(path) ? path : null;
}

/**
 * The path from a tapped notification: in the data the app was given (a notification it showed itself, the app being open), or in Firebase's
 * own message (one the phone showed while the app was closed).
 */
export function tappedPath(response: { notification: { request: { content: { data?: unknown }; trigger?: unknown } } }): string | null {
  const data = response.notification.request.content.data as Record<string, unknown> | null | undefined;
  const trigger = response.notification.request.trigger as { remoteMessage?: { data?: Record<string, unknown> } } | null | undefined;
  return screenOf(data?.path) ?? screenOf(trigger?.remoteMessage?.data?.path);
}
