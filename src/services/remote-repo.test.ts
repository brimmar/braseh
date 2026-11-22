import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { RemoteRepoService, RemoteRepoServiceLive } from './remote-repo';
import { SystemCommand } from './exec';
import { FileSystem } from './fs';

describe('RemoteRepoService', () => {
  it('should resolve shorthand to GitHub URL', async () => {
    const program = Effect.gen(function* () {
      const service = yield* RemoteRepoService;
      return yield* service.resolve('brimmar/braseh');
    });

    const result = await Effect.runPromise(program.pipe(
      Effect.provide(RemoteRepoServiceLive),
      Effect.provide(Layer.succeed(SystemCommand, SystemCommand.of({ run: () => Effect.succeed(''), execFile: () => Effect.succeed('') }))),
      Effect.provide(Layer.succeed(FileSystem, FileSystem.of({ writeFileBytes: () => Effect.void } as any)))
    ));

    expect(result).toBe('https://github.com/brimmar/braseh.git');
  });

  it('should clone a repository', async () => {
    let executedCommand = '';
    const MockExec = Layer.succeed(SystemCommand, SystemCommand.of({
      run: (cmd) => Effect.sync(() => { executedCommand = cmd; return ''; }),
      execFile: (file, args) => Effect.sync(() => { executedCommand = [file, ...args].join(' '); return ''; }),
    }));

    const program = Effect.gen(function* () {
      const service = yield* RemoteRepoService;
      yield* service.clone('https://github.com/brimmar/braseh.git', '/tmp/braseh');
    });

    await Effect.runPromise(program.pipe(
      Effect.provide(RemoteRepoServiceLive),
      Effect.provide(MockExec),
      Effect.provide(Layer.succeed(FileSystem, FileSystem.of({ writeFileBytes: () => Effect.void } as any)))
    ));

    expect(executedCommand).toContain('git clone -- https://github.com/brimmar/braseh.git /tmp/braseh');
  });

  it('passes a URL with shell metacharacters to git as one argument', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const MockExec = Layer.succeed(SystemCommand, SystemCommand.of({
      run: () => Effect.die('clone must not go through a shell'),
      execFile: (file, args) => Effect.sync(() => { calls.push({ file, args }); return ''; }),
    }));
    const url = 'file:///x;echo INJECTED-$((6*7))';

    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* RemoteRepoService;
      yield* service.clone(url, '/tmp/dest');
    }).pipe(Effect.provide(RemoteRepoServiceLive), Effect.provide(MockExec)));

    expect(calls).toEqual([{ file: 'git', args: ['clone', '--', url, '/tmp/dest'] }]);
  });
});
