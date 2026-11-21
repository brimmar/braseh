import { afterEach, describe, expect, it } from 'bun:test';
import { exists, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrasehError } from './core/errors';
import { brasehInit, parseInitArgs } from './commands/init';
import { tsconfigJson } from './commands/prepare';

function exportedNames(src: string): Set<string> {
  const names = new Set<string>();
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const match of stripped.matchAll(
    /export\s+(?:declare\s+)?(?:type|class|function|const|interface|enum)\s+(\w+)/g,
  )) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of stripped.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    const body = match[1];
    if (!body) continue;
    for (const part of body.split(',')) {
      const id = part.trim();
      if (!id) continue;
      const name = id.split(/\s+as\s+/).pop()?.trim();
      if (name && /^\w+$/.test(name)) names.add(name);
    }
  }
  return names;
}

describe('braseh init', () => {
  const testProjectDir = join(tmpdir(), `braseh-test-project-${Math.random().toString(36).slice(2)}`);

  afterEach(async () => {
    if (await exists(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
  });

  it('writes a project that imports from braseh, not this repo', async () => {
    await brasehInit(testProjectDir);

    expect(await exists(testProjectDir)).toBe(true);
    const content = await Bun.file(join(testProjectDir, 'braseh.ts')).text();
    expect(content).toContain("from 'braseh'");
    expect(content).not.toContain('src/public');
    expect(content).toContain("onPlatform('darwin'");
    expect(content).toContain("onDistro('ubuntu'");
    expect(content).toContain("pkg('build-essential')");
  });

  it('does not treat --force as the project directory', () => {
    expect(parseInitArgs(['--force'])).toEqual({ projectDir: './my-dotfiles', force: true });
    expect(parseInitArgs(['--force', './x'])).toEqual({ projectDir: './x', force: true });
    expect(parseInitArgs(['./x', '--force'])).toEqual({ projectDir: './x', force: true });
    expect(parseInitArgs([])).toEqual({ projectDir: './my-dotfiles', force: false });
  });

  it('refuses to re-init when braseh.ts exists unless force is set', async () => {
    await mkdir(testProjectDir, { recursive: true });
    const existing = '// keep me\nexport default () => {};\n';
    await writeFile(join(testProjectDir, 'braseh.ts'), existing);

    await expect(brasehInit(testProjectDir)).rejects.toThrow(BrasehError);
    await expect(brasehInit(testProjectDir)).rejects.toThrow(/Refusing to overwrite/);
    expect(await Bun.file(join(testProjectDir, 'braseh.ts')).text()).toBe(existing);

    await brasehInit(testProjectDir, { force: true });
    const content = await Bun.file(join(testProjectDir, 'braseh.ts')).text();
    expect(content).toContain("from 'braseh'");
    expect(content).not.toContain('keep me');
  });

  it('writes tsconfig.json and .gitignore when missing', async () => {
    await brasehInit(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'tsconfig.json')).text()).toBe(tsconfigJson());
    expect(await Bun.file(join(testProjectDir, '.gitignore')).text()).toBe(
      `node_modules
.braseh/state.json
.braseh/secrets.json
`,
    );
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

    await brasehInit(testProjectDir);

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

    await brasehInit(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'tsconfig.json')).text()).toBe(existing);
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

    await brasehInit(testProjectDir);

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

    const err = await brasehInit(testProjectDir).catch((error: unknown) => error);
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

    await brasehInit(testProjectDir);

    expect(await Bun.file(join(testProjectDir, 'tsconfig.json')).text()).toBe(existing);
  });

  it('does not overwrite an existing .gitignore', async () => {
    await mkdir(testProjectDir, { recursive: true });
    const existing = 'dist\n*.log\n';
    await writeFile(join(testProjectDir, '.gitignore'), existing);

    await brasehInit(testProjectDir);

    expect(await Bun.file(join(testProjectDir, '.gitignore')).text()).toBe(existing);
  });

  it('writes .braseh/types/index.d.ts describing pkg', async () => {
    await brasehInit(testProjectDir);

    const dts = await Bun.file(join(testProjectDir, '.braseh/types/index.d.ts')).text();
    expect(dts.includes('declare') || dts.includes('export function pkg')).toBe(true);
    expect(dts).toContain('pkg');
  });
});

describe('embedded public API types', () => {
  it('names every export from src/public.ts', async () => {
    const src = await Bun.file(join(import.meta.dir, 'public.ts')).text();
    const dts = await Bun.file(join(import.meta.dir, 'embedded/public-api.d.ts')).text();
    const srcNames = exportedNames(src);
    const dtsNames = exportedNames(dts);
    const missing = [...srcNames].filter((name) => !dtsNames.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it('onPlatform and onDistro callbacks receive api', async () => {
    const dts = await Bun.file(join(import.meta.dir, 'embedded/public-api.d.ts')).text();
    expect(dts).toContain('fn: (api: CommonApi)');
    expect(dts).toContain('fn: (api: ApiFor<O>)');
    expect(dts).toContain('fn: (api: LinuxApi)');
    expect(dts).toContain('fn: (api: ArchApi)');
    expect(dts).toContain('fn: (api: DistroApiFor<D>)');
  });
});
