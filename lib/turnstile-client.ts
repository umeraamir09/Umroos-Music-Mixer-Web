type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    execution: "execute";
    appearance: "interaction-only";
    callback: (token: string) => void;
    "error-callback": () => void;
    "expired-callback": () => void;
  }) => string;
  execute: (widget: string) => void;
  remove: (widget: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("Human verification did not load."));
    script.onerror = () => { script.remove(); reject(new Error("Human verification did not load.")); };
    document.head.appendChild(script);
  }).catch((error) => { scriptPromise = undefined; throw error; });
  return scriptPromise;
}

export async function getTurnstileToken(action: "demo_generate" | "access_request") {
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!sitekey) {
    if (process.env.NODE_ENV !== "production") return "";
    throw new Error("The demo is temporarily unavailable.");
  }
  const api = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:10000";
    document.body.appendChild(container);
    let widget = "";
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (widget) { try { api.remove(widget); } catch { /* Widget may already be gone. */ } }
      container.remove();
      if (token) resolve(token);
      else reject(new Error("Human verification failed. Please retry."));
    };
    const timeout = window.setTimeout(() => finish(), 120_000);
    try {
      widget = api.render(container, {
        sitekey,
        action,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token) => finish(token),
        "error-callback": () => finish(),
        "expired-callback": () => finish(),
      });
      api.execute(widget);
    } catch { finish(); }
  });
}
