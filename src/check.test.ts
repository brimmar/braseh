import { afterEach, describe, expect, it } from 'bun:test';
import { exists, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brasehCheck } from './commands/check';

describe('braseh check', () => {
  const testDir = join(tmpdir(), `braseh-check-test-${Math.random().toString(36).slice(2)}`);

  afterEach(async () => {
    if (await exists(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  async function writeTypes(): Promise<void> {
    const typesDir = join(testDir, '.braseh', 'types');
    await mkdir(typesDir, { recursive: true });
    await writeFile(join(typesDir, 'index.d.ts'), 'export declare function pkg(name: string): { id: string };\n');
  }

  it('should validate a correct configuration', async () => {
    await mkdir(testDir, { recursive: true });
    await writeTypes();
    const configPath = join(testDir, 'braseh-ok.ts');
    await writeFile(
      configPath,
      `
      export default () => {};
    `,
    );

    await brasehCheck(configPath);
  });

  it('should fail on invalid configuration', async () => {
    await mkdir(testDir, { recursive: true });
    await writeTypes();
    const configPath = join(testDir, 'braseh-fail.ts');
    await writeFile(
      configPath,
      `
      export const config = {
        name: 'test-config',
        packages: [{ name: 'test', manager: 'invalid' }],
        symlinks: [],
        files: [],
      };
    `,
    );

    await expect(brasehCheck(configPath)).rejects.toThrow();
  });

  it('rejects a type error before loading the config', async () => {
    await mkdir(testDir, { recursive: true });
    await writeTypes();
    const configPath = join(testDir, 'braseh.ts');
    const marker = join(testDir, 'loaded.txt');
    await writeFile(
      configPath,
      `import { writeFileSync } from 'node:fs';
import { pkg } from 'braseh';
writeFileSync(${JSON.stringify(marker)}, 'loaded');
export default () => {
  pkg(1);
};
`,
    );

    await expect(brasehCheck(configPath)).rejects.toThrow();
    expect(await exists(marker)).toBe(false);
  });

  it('supports json mode and returns CheckResult', async () => {
    await mkdir(testDir, { recursive: true });
    await writeTypes();
    const configPath = join(testDir, 'braseh-json.ts');
    await writeFile(
      configPath,
      `
      export default () => {};
    `,
    );

    const result = await brasehCheck(configPath, { json: true });
    expect(result).toEqual({
      command: 'check',
      config: 'functional-config',
      success: true,
      valid: true,
    });
  });
});
