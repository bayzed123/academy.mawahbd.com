import type { Env as AppBindings } from "./env";

declare global {
  namespace Cloudflare {
    // lets `import { env } from "cloudflare:workers"` (and the vitest plugin) see our bindings and typed exports
    interface Env extends AppBindings {}
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }
  interface ImportMeta {
    readonly url: string;
  }
}
