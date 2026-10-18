export type AiProvider = {
  endpoint: URL;
  model: string;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

const OLLAMA_API_ENDPOINT = new URL("http://127.0.0.1:11434/");
const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b";

export function getConfiguredAiProvider(): AiProvider {
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(model)) {
    throw new Error("The local AI model configuration is invalid.");
  }

  return {
    endpoint: new URL(OLLAMA_API_ENDPOINT),
    model,
  };
}

export async function checkAiProviderStatus(
  provider: AiProvider,
): Promise<"ready" | "model-not-installed" | "service-unavailable"> {
  try {
    const response = await fetch(new URL("api/tags", provider.endpoint), {
      redirect: "error",
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
    if (!response.ok) return "service-unavailable";

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("models" in payload) ||
      !Array.isArray(payload.models)
    ) {
      return "service-unavailable";
    }

    return payload.models.some(
      (model) =>
        typeof model === "object" &&
        model !== null &&
        "name" in model &&
        model.name === provider.model,
    )
      ? "ready"
      : "model-not-installed";
  } catch {
    return "service-unavailable";
  }
}

export function aiProviderUnavailableMessage(
  status: "model-not-installed" | "service-unavailable",
  model: string,
): string {
  if (status === "model-not-installed") {
    return `The local AI model "${model}" is not installed. Run "ollama pull ${model}" and try again.`;
  }
  return "The local AI service is not running. Start Ollama on the CareerVerse server and try again.";
}

export async function requestAiCompletion(
  provider: AiProvider,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { temperature?: number; maxTokens?: number; responseFormat?: "json_object"; timeoutMs?: number } = {},
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(new URL("api/chat", provider.endpoint), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: false,
        keep_alive: "30m",
        ...(options.responseFormat ? { format: "json" } : {}),
        options: {
          temperature: options.temperature ?? 0.4,
          num_predict: options.maxTokens ?? 700,
          num_ctx: 4096,
        },
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiProviderError("The local AI model took too long to respond. Please try again.", 504);
    }
    throw new AiProviderError(
      "The local AI service is not running. Start Ollama and make sure the configured model is installed.",
      503,
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new AiProviderError(
        `The local AI model "${provider.model}" is not installed. Run "ollama pull ${provider.model}" and try again.`,
        503,
      );
    }
    console.error("Local Ollama API returned an error status.", response.status);
    throw new AiProviderError("The local AI service could not complete this request.", 502);
  }

  const responseText = await response.text();
  if (Buffer.byteLength(responseText, "utf8") > 64_000) {
    throw new Error("The AI service returned an oversized response.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("The AI service returned an invalid response.");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("message" in payload) ||
    typeof payload.message !== "object" ||
    payload.message === null ||
    !("content" in payload.message) ||
    typeof payload.message.content !== "string"
  ) {
    throw new Error("The AI service returned an empty or invalid answer.");
  }

  const answer = payload.message.content.trim();
  if (!answer) throw new Error("The AI service returned an empty or invalid answer.");
  return answer;
}
