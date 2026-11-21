import { afterEach, describe, expect, it } from 'bun:test';
import { exists, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrasehError } from '../core/errors';
import { brasehPrepare, tsconfigJson } from './prepare';

describe('braseh prepare', () => {
  const testProjectDir = join(tmpdir(), `braseh-test-prepare-${Math.random().toString(36).slice(2)}`);

  afterEach(async () => {
    if (await exists(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
  });

  it('preserves an existing braseh.ts body and rewrites types', async () => {
    await mkdir(testProjectDir, { recursive: true });
    const custom = '// keep me\nexport default () => {};\n';
    await writeFile(join(testProjectDir, 'braseh.ts'), custom);

    await brasehPrepare(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'braseh.ts')).text()).toBe(custom);
    const dts = await Bun.file(join(testProjectDir, '.braseh/types/index.d.ts')).text();
    expect(dts).toContain('pkg');
    expect(dts.includes('declare') || dts.includes('export function pkg')).toBe(true);
  });

  it('merges paths.braseh into an existing tsconfig without clobbering other fields', async () => {
    await mkdir(testProjectDir, { recursive: true });
    await writeFile(
      join(testProjectDir, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: false,
            target: 'ES2020',
            paths: { '@lib/*': ['./lib/*'] },
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      )}\n`,
    );

    await brasehPrepare(testProjectDir);

    const tsconfig = JSON.parse(await Bun.file(join(testProjectDir, 'tsconfig.json')).text());
    expect(tsconfig).toEqual({
      compilerOptions: {
        strict: false,
        target: 'ES2020',
        paths: {
          '@lib/*': ['./lib/*'],
          braseh: ['./.braseh/types'],
        },
      },
      include: ['src/**/*.ts'],
    });
  });

  it('leaves tsconfig.json unchanged when paths.braseh already exists', async () => {
    await mkdir(testProjectDir, { recursive: true });
    const existing = '{\n  "compilerOptions": {\n    "paths": {\n      "braseh": ["./custom"]\n    }\n  }\n}\n';
    await writeFile(join(testProjectDir, 'tsconfig.json'), existing);

    await brasehPrepare(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'tsconfig.json')).text()).toBe(existing);
  });

  it('writes tsconfig.json with paths.braseh when missing', async () => {
    await brasehPrepare(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'tsconfig.json')).text()).toBe(tsconfigJson());
  });

  it('merges paths.braseh into a JSONC tsconfig with comments', async () => {
    await mkdir(testProjectDir, { recursive: true });
    await writeFile(
      join(testProjectDir, 'tsconfig.json'),
      `{
  // Visit https://aka.ms/tsconfig to read more about this file
  "compilerOptions": {
    /* Language and Environment */
    "strict": true,
    "target": "ESNext"
  },
  "include": ["src/**/*.ts"]
}
`,
    );

    await brasehPrepare(testProjectDir);

    const tsconfig = JSON.parse(await Bun.file(join(testProjectDir, 'tsconfig.json')).text());
    expect(tsconfig.compilerOptions.paths.braseh).toEqual(['./.braseh/types']);
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.target).toBe('ESNext');
    expect(tsconfig.include).toEqual(['src/**/*.ts']);
    expect(await exists(join(testProjectDir, '.braseh/types/index.d.ts'))).toBe(true);
  });

  it('throws BrasehError when tsconfig.json is invalid JSONC', async () => {
    await mkdir(testProjectDir, { recursive: true });
    await writeFile(join(testProjectDir, 'tsconfig.json'), '{ this is not json');

    const err = await brasehPrepare(testProjectDir).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(BrasehError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect((err as BrasehError).message).toMatch(/Could not parse/);
    expect((err as BrasehError).hint).toMatch(/JSON\/JSONC/);
  });

  it('leaves JSONC tsconfig bytes unchanged when paths.braseh already exists', async () => {
    await mkdir(testProjectDir, { recursive: true });
    const existing = `{
  // keep this comment
  "compilerOptions": {
    /* and this block */
    "paths": {
      "braseh": ["./custom"]
    }
  }
}
`;
    await writeFile(join(testProjectDir, 'tsconfig.json'), existing);
    expect(() => JSON.parse(existing)).toThrow(SyntaxError);

    await brasehPrepare(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'tsconfig.json')).text()).toBe(existing);
  });
});
