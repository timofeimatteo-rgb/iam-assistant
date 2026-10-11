// Каталог локальных языковых моделей (формат GGUF, движок llama.cpp).
// Все модели — Apache 2.0: бесплатно, можно использовать в коммерческой студии и распространять.
// Размеры файлов взяты из репозиториев Hugging Face (октябрь 2026).
const GB = 2 ** 30;

export const MODELS = [
  {
    id: 'qwen3.5-2b',
    tier: 'Лёгкая',
    name: 'Qwen3.5 2B',
    vendor: 'Alibaba Qwen',
    license: 'Apache 2.0',
    file: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    size: 1280835840,
    ramChat: 2.0 * GB,        // ориентировочно при контексте 4096
    minRam: 8 * GB,
    note: 'Быстрая и экономная. По-русски отвечает просто, иногда с ошибками. Для MacBook Air с 8 ГБ.',
    args: ['--chat-template-kwargs', '{"enable_thinking":false}'],
  },
  {
    id: 'gemma4-e2b',
    tier: 'Сбалансированная',
    name: 'Gemma 4 E2B',
    vendor: 'Google DeepMind',
    license: 'Apache 2.0',
    file: 'gemma-4-E2B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    size: 3106738272,
    ramChat: 3.6 * GB,
    minRam: 8 * GB,
    note: 'Заметно лучше говорит по-русски. Хороший выбор для 16 ГБ, работает и на 8 ГБ.',
    args: [],
  },
  {
    id: 'gemma4-e4b',
    tier: 'Качественная',
    name: 'Gemma 4 E4B',
    vendor: 'Google DeepMind',
    license: 'Apache 2.0',
    file: 'gemma-4-E4B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    size: 4977171584,
    ramChat: 5.8 * GB,
    minRam: 16 * GB,
    note: 'Самые связные ответы из трёх. Только для компьютеров с 16 ГБ памяти и больше.',
    args: [],
  },
];

export const byId = (id) => MODELS.find((m) => m.id === id);

// Рекомендация по объёму памяти компьютера.
export function recommend(totalRam) {
  if (!totalRam) return 'gemma4-e2b';
  if (totalRam < 12 * GB) return 'qwen3.5-2b';
  return 'gemma4-e2b';
}
export function fits(model, totalRam) { return !totalRam || totalRam >= model.minRam * 0.95; }
// Место на диске: файл модели + запас 10 % на временный файл загрузки.
export const diskNeeded = (m) => Math.round(m.size * 1.1);
