import { DurableObject } from "cloudflare:workers";
import { containerEnvironment, forwardRequest, isCanonicalRequest } from "./policy.mjs";

const idleTimeout = 10 * 60 * 1000;

export class CalContainer extends DurableObject<Env> {
  private starting?: Promise<void>;
  private monitoring?: Promise<void>;
  private ready = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) {
      ctx.waitUntil(ctx.container.setInactivityTimeout(idleTimeout));
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!isCanonicalRequest(request, this.env.PUBLIC_APP_URL))
      return new Response("Unknown origin", { status: 421 });
    try {
      if (!this.ready || !this.ctx.container?.running) {
        this.starting ??= this.startAndWait().finally(() => {
          this.starting = undefined;
        });
        await this.starting;
      }
      // Never replay a forwarded request: a failed response can follow a committed booking.
      const container = this.ctx.container;
      if (!container) throw new Error("CAL container binding is missing");
      return await container.getTcpPort(3000).fetch(forwardRequest(request, this.env.PUBLIC_APP_URL));
    } catch {
      console.error(JSON.stringify({ event: "cal_request_failed" }));
      return new Response("CAL is temporarily unavailable.", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
  }

  private async startAndWait(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("CAL container binding is missing");
    this.ready = false;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "standard-1",
        enableInternet: true,
        env: containerEnvironment({ ...this.env }),
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(idleTimeout);
    const probe = forwardRequest(
      new Request(`${this.env.PUBLIC_APP_URL}/.well-known/oauth-protected-resource`),
      this.env.PUBLIC_APP_URL
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await container
          .getTcpPort(3000)
          .fetch(probe.clone(), { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) {
          this.ready = true;
          return;
        }
      } catch {
        // Only this read-only readiness request may be retried.
      }
      await scheduler.wait(200);
    }
    throw new Error("CAL container startup timed out");
  }

  private observeExit(): void {
    if (this.monitoring || !this.ctx.container) return;
    this.monitoring = this.ctx.container
      .monitor()
      .then(() => {
        console.log(JSON.stringify({ event: "cal_container_stopped" }));
      })
      .catch(() => {
        console.error(JSON.stringify({ event: "cal_container_failed" }));
      })
      .finally(() => {
        this.ready = false;
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isCanonicalRequest(request, env.PUBLIC_APP_URL))
      return new Response("Unknown origin", { status: 421 });
    // One container for this private installation; PostgreSQL holds all durable application state.
    return env.CAL_CONTAINER.getByName("private-v1").fetch(request);
  },
} satisfies ExportedHandler<Env>;
