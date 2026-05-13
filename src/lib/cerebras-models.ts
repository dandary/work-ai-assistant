/** Модели, доступные в Cerebras Cloud (OpenAI-совместимый API). */
export const CEREBRAS_MODELS: { id: string; label: string }[] = [
  { id: "gpt-oss-120b", label: "gpt-oss-120b" },
  { id: "zai-glm-4.7", label: "zai-glm-4.7" },
  { id: "qwen-3-235b-a22b-instruct-2507", label: "qwen-3-235b-a22b-instruct-2507" },
  { id: "llama3.1-8b", label: "llama3.1-8b" },
];

export const DEFAULT_CEREBRAS_MODEL = "llama3.1-8b";

export const CEREBRAS_MODEL_IDS = new Set(CEREBRAS_MODELS.map((m) => m.id));
