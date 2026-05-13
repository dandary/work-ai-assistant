import { z } from "zod";

/** Макс. сообщений в одном запросе (user+assistant пары + новое). */
export const ASSISTANT_MAX_MESSAGES = 80;

/** Макс. длина одного сообщения (символы Unicode). */
export const ASSISTANT_MAX_MESSAGE_CHARS = 32_000;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .max(
      ASSISTANT_MAX_MESSAGE_CHARS,
      `Сообщение длиннее ${ASSISTANT_MAX_MESSAGE_CHARS} символов`,
    )
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Пустое сообщение"),
});

export const assistantRequestSchema = z.object({
  conversationId: z.string().cuid("Некорректный идентификатор чата"),
  preset: z.string().optional(),
  model: z.string().optional(),
  messages: z
    .array(chatMessageSchema)
    .min(1, "Нужен хотя бы один ответ пользователя или ассистента")
    .max(
      ASSISTANT_MAX_MESSAGES,
      `Не более ${ASSISTANT_MAX_MESSAGES} сообщений за запрос`,
    ),
});

export type AssistantRequestInput = z.infer<typeof assistantRequestSchema>;

export function formatZodError(err: z.ZodError): string {
  const flat = err.flatten();
  const field = Object.entries(flat.fieldErrors)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("; ");
  const form = flat.formErrors?.length ? flat.formErrors.join("; ") : "";
  return [form, field].filter(Boolean).join(" ") || "Некорректные данные запроса";
}
