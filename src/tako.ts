import type { TakoAnswer, TakoCard } from "./types";

const ANSWER_URL = "https://tako.com/api/v1/answer";
const PROXY_URL = process.env.EXPO_PUBLIC_TAKO_PROXY_URL?.trim().replace(/\/$/, "") || "";
const DEMO_ACCESS_TOKEN = process.env.EXPO_PUBLIC_DEMO_ACCESS_TOKEN?.trim() || "";
const VEHICLE_LOCATION = { latitude: 52.4227, longitude: 10.7865 };
const DEFAULT_ATTEMPT_TIMEOUTS = [18_000, 26_000];

export const usesHostedRelay = Boolean(PROXY_URL);

export type TakoErrorCode =
  | "setup"
  | "network"
  | "timeout"
  | "auth"
  | "credits"
  | "rate-limit"
  | "server"
  | "invalid-response"
  | "cancelled";

export class TakoRequestError extends Error {
  constructor(
    public readonly code: TakoErrorCode,
    public readonly userMessage: string,
    public readonly technicalMessage: string,
    public readonly requestId?: string,
    public readonly status?: number,
  ) {
    super(userMessage);
    this.name = "TakoRequestError";
  }
}

type FetchLike = typeof fetch;

export type AskTakoOptions = {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  attemptTimeouts?: number[];
  retryDelayMs?: number;
  onRetry?: (attempt: number, reason: TakoErrorCode) => void;
};

export type RelayHealth = {
  ok: boolean;
  configured?: boolean;
  service?: string;
  version?: string;
  requestId?: string;
  elapsedMs: number;
};

export const isWeatherQuery = (query: string): boolean =>
  /\b(weather|forecast|temperature|rain|snow|sunny|wind|humidity)\b/i.test(query);

export const normalizeCard = (card: Record<string, unknown>, index: number): TakoCard => {
  const embedUrl = String(card.embed_url ?? card.embedUrl ?? "");
  const sources = Array.isArray(card.sources)
    ? card.sources.map((source) => {
      if (typeof source === "string") return source;
      if (source && typeof source === "object") {
        const record = source as Record<string, unknown>;
        return String(record.source_name ?? record.name ?? "Data source");
      }
      return String(source);
    })
    : [];
  return {
    id: String(card.id ?? card.card_id ?? card.cardId ?? `card-${index}`),
    title: String(card.title ?? "Knowledge card"),
    embedUrl,
    imageUrl: card.image_url ? String(card.image_url) : undefined,
    webpageUrl: card.webpage_url ? String(card.webpage_url) : undefined,
    description: card.description ? String(card.description) : undefined,
    sources,
  };
};

export const toGlanceableUrl = (embedUrl: string): string => {
  if (!embedUrl) return "";
  try {
    const url = new URL(embedUrl);
    url.searchParams.set("glanceable", "true");
    url.searchParams.set("dark_mode", "true");
    return url.toString();
  } catch {
    const separator = embedUrl.includes("?") ? "&" : "?";
    return `${embedUrl}${separator}glanceable=true&dark_mode=true`;
  }
};

const delay = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

function abortError(externalSignal?: AbortSignal) {
  return new TakoRequestError(
    externalSignal?.aborted ? "cancelled" : "timeout",
    externalSignal?.aborted
      ? "That request was cancelled. Tap the microphone when you’re ready."
      : "The answer service is taking too long. Check the connection and try again.",
    externalSignal?.aborted ? "Request cancelled by the app lifecycle." : "Request attempt timed out.",
  );
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const cancel = () => controller.abort();
  externalSignal?.addEventListener("abort", cancel, { once: true });
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw abortError(externalSignal);
    const technicalMessage = error instanceof Error ? error.message : String(error);
    throw new TakoRequestError(
      "network",
      "I couldn’t reach the answer service. I’ll retry automatically.",
      technicalMessage,
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", cancel);
  }
}

function errorForResponse(status: number, payload: any, requestId?: string) {
  const technicalMessage = String(payload?.error_message ?? payload?.error ?? `HTTP ${status}`);
  if (status === 401 || status === 403) {
    return new TakoRequestError(
      "auth",
      usesHostedRelay
        ? "This demo build is no longer authorized. Ask the demo administrator for a fresh build."
        : "The data-access key was not accepted. Ask the demo administrator to check it.",
      technicalMessage,
      requestId,
      status,
    );
  }
  if (status === 402) {
    return new TakoRequestError("credits", "The answer service is out of credits.", technicalMessage, requestId, status);
  }
  if (status === 429) {
    return new TakoRequestError("rate-limit", "The demo is receiving too many requests. Please wait a moment and try again.", technicalMessage, requestId, status);
  }
  return new TakoRequestError(
    "server",
    "The answer service had a temporary problem. I’ll retry automatically.",
    technicalMessage,
    requestId,
    status,
  );
}

function isRetryable(error: unknown) {
  return error instanceof TakoRequestError
    && (error.code === "network" || error.code === "timeout" || (error.code === "server" && (error.status ?? 500) >= 500));
}

export async function askTako(query: string, apiKey?: string | null, options: AskTakoOptions = {}): Promise<TakoAnswer> {
  if (!usesHostedRelay && !apiKey) {
    throw new TakoRequestError(
      "setup",
      "Assistant setup is incomplete. Ask the demo administrator for help.",
      "No hosted relay or direct API key is configured.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const attemptTimeouts = options.attemptTimeouts?.length ? options.attemptTimeouts : DEFAULT_ATTEMPT_TIMEOUTS;
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < attemptTimeouts.length; attemptIndex += 1) {
    if (options.signal?.aborted) throw abortError(options.signal);
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        usesHostedRelay ? `${PROXY_URL}/answer` : ANSWER_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-VW-Client-Version": "1.4.0",
            ...(usesHostedRelay
              ? (DEMO_ACCESS_TOKEN ? { Authorization: `Bearer ${DEMO_ACCESS_TOKEN}` } : {})
              : { "X-API-Key": apiKey as string }),
          },
          body: JSON.stringify({
            query,
            effort: "fast",
            ...(isWeatherQuery(query) ? { sources: { data: { count: 10 }, web: { count: 10 } } } : {}),
            location: VEHICLE_LOCATION,
            country_code: "DE",
            locale: "en-US",
            timezone: "Europe/Berlin",
            output_settings: { image_dark_mode: true },
          }),
        },
        attemptTimeouts[attemptIndex]!,
        options.signal,
      );
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw errorForResponse(response.status, payload, requestId);
      if (!payload || typeof payload.answer !== "string" || !payload.answer.trim()) {
        throw new TakoRequestError(
          "invalid-response",
          "The answer arrived in an unexpected format. Please try another question.",
          "Successful response did not contain a non-empty answer string.",
          requestId,
        );
      }

      return {
        answer: payload.answer.trim(),
        cards: Array.isArray(payload.cards)
          ? payload.cards.filter((card: unknown) => card && typeof card === "object").map(normalizeCard)
          : [],
        requestId: payload.request_id ? String(payload.request_id) : requestId,
        elapsedMs: Date.now() - startedAt,
        attemptCount: attemptIndex + 1,
      };
    } catch (error) {
      lastError = error;
      const hasAnotherAttempt = attemptIndex + 1 < attemptTimeouts.length;
      if (!hasAnotherAttempt || !isRetryable(error) || options.signal?.aborted) throw error;
      const reason = error instanceof TakoRequestError ? error.code : "network";
      options.onRetry?.(attemptIndex + 2, reason);
      await delay(options.retryDelayMs ?? 650);
    }
  }

  throw lastError;
}

export async function checkRelay(options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<RelayHealth> {
  const startedAt = Date.now();
  if (!usesHostedRelay) {
    return { ok: true, configured: true, service: "direct-tako", version: "1.4.0", elapsedMs: 0 };
  }
  const response = await fetchWithTimeout(
    options.fetchImpl ?? fetch,
    `${PROXY_URL}/health`,
    { method: "GET", headers: { "X-VW-Client-Version": "1.4.0" } },
    options.timeoutMs ?? 6_000,
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw errorForResponse(response.status, payload, response.headers.get("x-request-id") ?? undefined);
  return {
    ok: true,
    configured: Boolean(payload.configured),
    service: payload.service,
    version: payload.version,
    requestId: response.headers.get("x-request-id") ?? undefined,
    elapsedMs: Date.now() - startedAt,
  };
}

export function userMessageForError(error: unknown): string {
  if (error instanceof TakoRequestError) {
    if (error.code === "network") return "Connection interrupted. Check Wi-Fi, then tap Retry.";
    return error.userMessage;
  }
  return "The assistant hit an unexpected problem. Tap Retry to try again.";
}
