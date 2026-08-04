import type { Hono } from "hono";
import { createApp } from "./app.js";

/**
 * Cloudflare Workers entrypoint.
 *
 * The app is built on the first request rather than at module scope: bindings
 * are surfaced on process.env by `nodejs_compat_populate_process_env`, and
 * building lazily avoids depending on exactly when that happens during module
 * evaluation. The instance is then reused for the life of the isolate.
 */

let app: Hono | undefined;

export default {
  fetch(request: Request, env: unknown, ctx: unknown): Response | Promise<Response> {
    if (!app) app = createApp();
    // Hono's fetch signature is runtime-specific; the Workers ExecutionContext
    // type isn't available without @cloudflare/workers-types, so pass it through.
    return (app.fetch as (r: Request, e: unknown, c: unknown) => Response | Promise<Response>)(
      request,
      env,
      ctx,
    );
  },
};
