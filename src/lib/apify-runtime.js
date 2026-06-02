import fs from 'node:fs/promises';
import path from 'node:path';

export async function getActorRuntime() {
  if (process.env.APIFY_IS_AT_HOME !== '1') return localActorFallback();
  try {
    const { Actor } = await import('apify');
    return Actor;
  } catch {
    return localActorFallback();
  }
}

function localActorFallback() {
  return {
    async init() {},
    async exit() {},
    async getInput() {
      if (process.env.APIFY_INPUT) return JSON.parse(process.env.APIFY_INPUT);
      try {
        return JSON.parse(await fs.readFile('INPUT.json', 'utf8'));
      } catch {
        return null;
      }
    },
    async pushData(item) {
      const file = 'output/latest/dataset.jsonl';
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify(item)}\n`);
    },
    async setValue(key, value) {
      await fs.mkdir('output/latest/kv', { recursive: true });
      const fileName = key.replace(/[^a-z0-9_.-]/gi, '_');
      const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      await fs.writeFile(`output/latest/kv/${fileName}`, `${body}\n`);
    },
  };
}
