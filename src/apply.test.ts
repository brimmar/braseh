import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { brasehApply, dryRunFileSystem } from './commands/apply';
import { FileSystem, FileSystemLive } from './services/fs';
import { SystemCommandLive } from './services/exec';

describe('braseh apply', () => {
  const testDir = join(tmpdir(), 'braseh-apply-test-' + Math.random().toString(36).slice(2));

  it('should load and validate a braseh.ts file', async () => {
    const configPath = join(testDir, 'braseh-apply-ok.ts');
    await mkdir(testDir, { recursive: true });
    await writeFile(configPath, `
      export default () => {};
    `);

    // Note: brasehApply is an async function that handles its own Effect running
    // We expect it to work without additional wrapping
    await brasehApply(configPath);
  });

  it('should throw an error if braseh.ts is missing', async () => {
    expect(brasehApply(join(testDir, 'non-existent.ts'))).rejects.toThrow();
  });

  it('dry-run of file() does not create the file', async () => {
    const dir = join(tmpdir(), 'braseh-dry-run-file-' + Math.random().toString(36).slice(2));
    const target = join(dir, 'out.txt');
    const configPath = join(dir, 'braseh.ts');
    await mkdir(dir, { recursive: true });
    await writeFile(
      configPath,
      `
      import { file } from 'braseh';
      export default () => {
        file(${JSON.stringify(target)}, { content: 'hello' });
      };
    `,
    );

    await brasehApply(configPath, { dryRun: true });
    expect(existsSync(target)).toBe(false);
  });

  it('dry-run of file() does not write .braseh/state.json', async () => {
    const dir = join(tmpdir(), 'braseh-dry-run-state-' + Math.random().toString(36).slice(2));
    const target = join(dir, 'out.txt');
    const configPath = join(dir, 'braseh.ts');
    await mkdir(dir, { recursive: true });
    await writeFile(
      configPath,
      `
      import { file } from 'braseh';
      export default () => {
        file(${JSON.stringify(target)}, { content: 'hello' });
      };
    `,
    );

    const prev = process.cwd();
    process.chdir(dir);
    try {
      await brasehApply(configPath, { dryRun: true });
      expect(existsSync(join(dir, '.braseh', 'state.json'))).toBe(false);
    } finally {
      process.chdir(prev);
    }
  });

  it('dry-run of script() does not evaluate unless', async () => {
    const dir = join(tmpdir(), 'braseh-dry-run-script-' + Math.random().toString(36).slice(2));
    const marker = join(dir, 'braseh-dry-run-should-not-run');
    const configPath = join(dir, 'braseh.ts');
    await mkdir(marker, { recursive: true });
    await writeFile(
      configPath,
      `
      import { script } from 'braseh';
      export default () => {
        script('echo would-write', { unless: ${JSON.stringify(`rm -rf ${marker}`)} });
      };
    `,
    );

    await brasehApply(configPath, { dryRun: true });
    expect(existsSync(marker)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('supports json mode and returns execution report', async () => {
    const dir = join(tmpdir(), 'braseh-apply-json-' + Math.random().toString(36).slice(2));
    const configPath = join(dir, 'braseh.ts');
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, `
      export default () => {};
    `);

    const result = await brasehApply(configPath, { json: true });
    expect(result.success).toBe(true);
    expect(result.command).toBe('apply');
    expect(result.summary).toBeDefined();
    expect(result.summary.created).toBe(0);
    expect(result.summary.converged).toBe(0);
    expect(Array.isArray(result.resources)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('supports verbose mode', async () => {
    const dir = join(tmpdir(), 'braseh-apply-verbose-' + Math.random().toString(36).slice(2));
    const configPath = join(dir, 'braseh.ts');
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, `
      export default () => {};
    `);

    const result = await brasehApply(configPath, { verbose: true });
    expect(result.success).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('dryRunFileSystem', () => {
  it('exists is live and writeFile does not change contents', async () => {
    const dir = join(tmpdir(), 'braseh-dry-fs-' + Math.random().toString(36).slice(2));
    const filePath = join(dir, 'existing.txt');
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, 'original');

    const program = Effect.gen(function* () {
      const live = yield* FileSystem;
      const dry = dryRunFileSystem(live);
      const exists = yield* dry.exists(filePath);
      yield* dry.writeFile(filePath, 'changed');
      const content = yield* dry.readFile(filePath);
      return { exists, content };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(FileSystemLive), Effect.provide(SystemCommandLive)),
    );

    expect(result.exists).toBe(true);
    expect(result.content).toBe('original');
    expect(readFileSync(filePath, 'utf8')).toBe('original');
  });

  it('keeps state next to each config, so applying one config never destroys another', async () => {
    const root = join(tmpdir(), 'braseh-two-configs-' + Math.random().toString(36).slice(2));
    const dirA = join(root, 'a');
    const dirB = join(root, 'b');
    const fileA = join(root, 'from-a.txt');
    const fileB = join(root, 'from-b.txt');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    const config = (target: string) => `import { file } from 'braseh';
export default () => { file(${JSON.stringify(target)}, { content: 'x' }); };`;
    await writeFile(join(dirA, 'braseh.ts'), config(fileA));
    await writeFile(join(dirB, 'braseh.ts'), config(fileB));

    const prev = process.cwd();
    process.chdir(dirA);
    try {
      await brasehApply(join(dirA, 'braseh.ts'), { json: true });
      // Before the fix this used a/.braseh/state.json and deleted from-a.txt.
      await brasehApply(join(dirB, 'braseh.ts'), { json: true });
    } finally {
      process.chdir(prev);
    }

    expect(existsSync(fileA)).toBe(true);
    expect(existsSync(fileB)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(join(dirA, '.braseh', 'state.json'), 'utf8')))).toEqual([`file:${fileA}`]);
    expect(Object.keys(JSON.parse(readFileSync(join(dirB, '.braseh', 'state.json'), 'utf8')))).toEqual([`file:${fileB}`]);
    await rm(root, { recursive: true, force: true });
  });
});
