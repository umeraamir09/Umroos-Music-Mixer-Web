// Jev (TypeSafe System One) evaluation client.
//
// Primary: OpenCode Zen at https://opencode.ai/zen/v1/systemone with the
// free jev-1.13-free model; fallback: the official TypeSafe API at
// https://api.typesafe.ai/v1/systemone. Both endpoints share the same
// request shape ({ model, state, questions }) and response shape
// ({ answers, usage }), so one fetch chain covers both.

const ATTEMPT_TIMEOUT_MS = 8000;

export type JevQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type JevAnswer = {
  type: "noul";
  noul: number;
};

export type JevQuestions = Record<string, JevQuestion>;

export type JevResult = {
  answers: Record<string, JevAnswer>;
  provider: string;
  model: string;
};

type JevProvider = {
  name: string;
  baseURL: string;
  model: string;
  apiKey: string;
};

export function jevLogsEnabled() {
  const raw = process.env.JEV_LOGS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configuredProviders(): JevProvider[] {
  const providers: JevProvider[] = [];
  const opencodeKey = process.env.OPENCODE_API_KEY;
  if (opencodeKey) {
    providers.push({
      name: "opencode",
      baseURL: "https://opencode.ai/zen/v1/systemone",
      model: process.env.JEV_MODEL || "jev-1.13-free",
      apiKey: opencodeKey,
    });
  }
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  if (typesafeKey) {
    providers.push({
      name: "typesafe",
      baseURL: "https://api.typesafe.ai/v1/systemone",
      model: process.env.JEV_OFFICIAL_MODEL || "jev-1.13.0",
      apiKey: typesafeKey,
    });
  }
  return providers;
}

export function hasJevProvider() {
  return configuredProviders().length > 0;
}

// Evaluates the shared state against every question in one round trip per
// provider. Tries OpenCode first and falls back to the official TypeSafe API;
// no in-provider retries, so a batch fails fast to local scoring.
export async function evaluateJev(input: { state: unknown; questions: JevQuestions; timeoutMs?: number }): Promise<JevResult> {
  const providers = configuredProviders();
  if (!providers.length) throw new Error("No Jev provider configured (OPENCODE_API_KEY or TYPESAFE_API_KEY)");

  let lastError: unknown;
  for (const provider of providers) {
    try {
      const response = await fetch(provider.baseURL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: provider.model, state: input.state, questions: input.questions }),
        signal: AbortSignal.timeout(input.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${provider.name} Jev request failed (${response.status})`);
      const data = (await response.json()) as { answers?: Record<string, JevAnswer> };
      if (!data.answers || typeof data.answers !== "object") throw new Error(`${provider.name} Jev response missing answers`);
      if (jevLogsEnabled()) console.log(`[jev] served by ${provider.name} (${provider.model})`);
      return { answers: data.answers, provider: provider.name, model: provider.model };
    } catch (error) {
      lastError = error;
      if (jevLogsEnabled()) {
        console.log(`[jev] ${provider.name} attempt failed:`, error instanceof Error ? { message: error.message, cause: error.cause } : error);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Jev evaluation failed");
}
