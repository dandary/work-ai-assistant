import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  assistantRequestSchema,
  formatZodError,
} from "@/lib/assistant-request";
import {
  CEREBRAS_MODEL_IDS,
  DEFAULT_CEREBRAS_MODEL,
} from "@/lib/cerebras-models";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  DEFAULT_PRESET,
  WORK_PRESETS,
  type WorkPresetId,
} from "@/lib/presets";

const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function trimEnvValue(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  let v = raw.trim().replace(/^\uFEFF/, "");
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.length > 0 ? v : undefined;
}

function getApiKey(): string | undefined {
  return trimEnvValue(process.env.CEREBRAS_API_KEY);
}

function getClientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return "unknown";
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function isPresetId(value: unknown): value is WorkPresetId {
  return typeof value === "string" && value in WORK_PRESETS;
}

function retryAfterMs(
  err: InstanceType<typeof OpenAI.APIError>,
  attemptZeroBased: number,
): number {
  const raw = err.headers?.get("retry-after");
  if (raw) {
    const sec = Number.parseFloat(raw);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 90_000);
  }
  const base = 4000 * 2 ** attemptZeroBased;
  return Math.min(base + Math.random() * 1500, 90_000);
}

function isInsufficientQuota(err: InstanceType<typeof OpenAI.APIError>): boolean {
  if (err.code === "insufficient_quota") return true;
  const body = typeof err.message === "string" ? err.message : "";
  if (/insufficient_quota/i.test(body)) return true;
  const nested = err.error as { code?: string } | undefined;
  return nested?.code === "insufficient_quota";
}

function cerebrasErrorPayload(err: unknown): { body: Record<string, string>; httpStatus: number } {
  if (err instanceof OpenAI.APIError) {
    const msg = err.message || "Запрос к Cerebras не выполнен.";
    let httpStatus = typeof err.status === "number" && err.status >= 400 ? err.status : 502;
    let error = msg;

    if (err.status === 401) {
      error =
        "Неверный или отозван ключ (401). Укажите CEREBRAS_API_KEY в .env.local (https://cloud.cerebras.ai/).";
    } else if (isInsufficientQuota(err)) {
      error = "Нет квоты или лимита на аккаунте Cerebras. Проверьте биллинг и план.";
      httpStatus = 402;
    } else if (err.status === 429) {
      error =
        "Лимит запросов (429) после повторных попыток. Подождите или проверьте тариф Cerebras.";
    } else if (err.status === 404) {
      error =
        "Модель не найдена (404). Выберите другую модель или задайте CEREBRAS_MODEL в .env.local.";
    } else if (err.status === 403) {
      error = "Доступ запрещён (403). Проверьте ключ и доступ к выбранной модели.";
    } else if (err.status === 503) {
      error = "Cerebras временно недоступен (503). Повторите запрос позже.";
    }

    return { body: { error }, httpStatus };
  }
  if (err instanceof Error) {
    return { body: { error: err.message }, httpStatus: 502 };
  }
  return { body: { error: "Неизвестная ошибка сервера" }, httpStatus: 502 };
}

async function createChatStream(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const attempts = Number.parseInt(process.env.CEREBRAS_MAX_RETRIES ?? "6", 10);
  const max = Number.isFinite(attempts) ? Math.min(Math.max(attempts, 1), 12) : 6;

  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    try {
      return await client.chat.completions.create(params);
    } catch (e) {
      lastErr = e;
      const retryable =
        e instanceof OpenAI.APIError &&
        !isInsufficientQuota(e) &&
        (e.status === 429 || e.status === 503);
      if (!retryable || i === max - 1) {
        throw e;
      }
      await sleep(retryAfterMs(e, i));
    }
  }
  throw lastErr;
}

function resolveModel(bodyModel: unknown): string {
  if (typeof bodyModel === "string") {
    const id = bodyModel.trim();
    if (id && CEREBRAS_MODEL_IDS.has(id)) return id;
  }
  return trimEnvValue(process.env.CEREBRAS_MODEL) ?? DEFAULT_CEREBRAS_MODEL;
}

function parseRateLimit(): { max: number; windowMs: number; disabled: boolean } {
  const disabled =
    trimEnvValue(process.env.ASSISTANT_RATE_LIMIT_DISABLED) === "1" ||
    process.env.ASSISTANT_RATE_LIMIT_DISABLED === "true";
  const maxRaw = Number.parseInt(process.env.ASSISTANT_RATE_LIMIT_MAX ?? "60", 10);
  const winRaw = Number.parseInt(
    process.env.ASSISTANT_RATE_LIMIT_WINDOW_MS ?? "60000",
    10,
  );
  return {
    disabled,
    max: Number.isFinite(maxRaw) ? Math.min(Math.max(maxRaw, 5), 1000) : 60,
    windowMs: Number.isFinite(winRaw) ? Math.min(Math.max(winRaw, 5000), 3_600_000) : 60_000,
  };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "CEREBRAS_API_KEY не задан. Добавьте ключ в .env.local (префикс csk-).",
      },
      {
        status: 500,
        headers: { "X-Request-Id": requestId },
      },
    );
  }

  const rl = parseRateLimit();
  if (!rl.disabled) {
    const ip = getClientIp(request);
    const hit = checkRateLimit(`assistant:${ip}`, rl.max, rl.windowMs);
    if (!hit.ok) {
      return NextResponse.json(
        {
          error: `Слишком много запросов. Повторите через ~${hit.retryAfterSec} с.`,
        },
        {
          status: 429,
          headers: {
            "X-Request-Id": requestId,
            "Retry-After": String(hit.retryAfterSec),
          },
        },
      );
    }
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректный JSON" },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const parsed = assistantRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const { messages, preset, model: bodyModel } = parsed.data;
  const normalized: ChatMessage[] = messages;

  const presetId = isPresetId(preset) ? preset : DEFAULT_PRESET;
  const system = WORK_PRESETS[presetId].system;
  const model = resolveModel(bodyModel);

  const baseURL = trimEnvValue(process.env.CEREBRAS_API_BASE_URL) ?? CEREBRAS_BASE_URL;

  const timeoutRaw = trimEnvValue(process.env.CEREBRAS_REQUEST_TIMEOUT_MS);
  const requestTimeoutMs = timeoutRaw
    ? Math.min(Math.max(Number.parseInt(timeoutRaw, 10), 10_000), 1_800_000)
    : 300_000;

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: requestTimeoutMs,
  });

  const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model,
    stream: true,
    messages: [
      { role: "system", content: system },
      ...normalized.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await createChatStream(client, createParams);
  } catch (e) {
    const { body: errBody, httpStatus } = cerebrasErrorPayload(e);
    return NextResponse.json(errBody, {
      status: httpStatus,
      headers: { "X-Request-Id": requestId },
    });
  }

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          let anyText = false;
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) {
              controller.enqueue(encoder.encode(text));
              anyText = true;
            }
          }
          if (!anyText) {
            controller.enqueue(
              encoder.encode(
                "Модель не вернула текст. Проверьте модель, квоту и запрос.",
              ),
            );
          }
        } catch (e) {
          const suffix = `\n\n[ошибка ответа: ${e instanceof Error ? e.message : String(e)}]`;
          controller.enqueue(encoder.encode(suffix));
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}
