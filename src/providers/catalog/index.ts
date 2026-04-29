import { ProviderCatalogSource } from "./types";
import cerebras from "./cerebras";
import cloudflare from "./cloudflare";
import gemini from "./gemini";
import githubModels from "./github-models";
import groq from "./groq";
import huggingface from "./huggingface";
import mistral from "./mistral";
import nvidiaNim from "./nvidia-nim";
import ollamaCloud from "./ollama-cloud";
import openrouter from "./openrouter";

const registeredProviders: ProviderCatalogSource[] = [
  cerebras,
  cloudflare,
  gemini,
  githubModels,
  groq,
  huggingface,
  mistral,
  nvidiaNim,
  ollamaCloud,
  openrouter,
];

export function loadByProviderId(providerId: string): ProviderCatalogSource | undefined {
  return registeredProviders.find((p) => p.id === providerId);
}

export function listAllProviders(): ProviderCatalogSource[] {
  return registeredProviders;
}

export default registeredProviders;
