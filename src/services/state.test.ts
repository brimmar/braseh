import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { StateService, StateServiceLive } from './state';
import { FileSystemLive } from './fs';
import { SystemCommandLive } from './exec';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';

describe('StateService', () => {
  const testDir = join(tmpdir(), 'braseh-state-test-' + Math.random().toString(36).slice(2));
  const stateFile = join(testDir, '.braseh/state.json');

  it('should save and load state', async () => {
    const program = Effect.gen(function* (_) {
      const state = yield* _(StateService);
      
      yield* _(state.setPath(stateFile));
      
      const initialState = yield* _(state.load());
      expect(initialState).toEqual({});
      
      yield* _(state.save({ 'res-1': { hash: 'abc', kind: 'file', metadata: {} } }));
      
      const loadedState = yield* _(state.load());
      expect(loadedState).toEqual({ 'res-1': { hash: 'abc', kind: 'file', metadata: {} } });
    });

    const runnable = program.pipe(
      Effect.provide(StateServiceLive),
      Effect.provide(FileSystemLive),
      Effect.provide(SystemCommandLive)
    );

    await Effect.runPromise(runnable);
    await rm(testDir, { recursive: true, force: true });
  });

  it('saves atomically with mode 0600 and reports corrupt JSON clearly', async () => {
    const dir = join(tmpdir(), 'braseh-state-atomic-' + Math.random().toString(36).slice(2));
    const path = join(dir, '.braseh', 'state.json');
    const run = <A>(f: (state: StateService) => Effect.Effect<A, Error>) =>
      Effect.runPromise(Effect.either(Effect.gen(function* () {
        const state = yield* StateService;
        yield* state.setPath(path);
        return yield* f(state);
      }).pipe(Effect.provide(StateServiceLive), Effect.provide(FileSystemLive), Effect.provide(SystemCommandLive))));

    await run((state) => state.save({ a: { hash: 'h', kind: 'file', metadata: {} } }));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readdir(dirname(path))).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    await writeFile(path, '{"a": {"hash": "h", "kin');
    const corrupt = await run((state) => state.load());
    expect(corrupt._tag === 'Left' ? corrupt.left.message : '').toContain('not valid JSON');

    await rm(dir, { recursive: true, force: true });
  });
});
