import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { App, Stack } from '../core/app';
import { AptRepositoryResource } from './apt-repository';
import { SystemCommand } from '../services/exec';
import { FileSystem } from '../services/fs';
import { HttpService } from '../services/http';
import { PlatformService } from '../services/platform';

describe('AptRepositoryResource', () => {
  const MockPlatform = Layer.succeed(PlatformService, PlatformService.of({
    get: () => Effect.succeed({ os: 'linux', distro: 'ubuntu' } as any)
  }));

  const MockFS = (files: Record<string, string> = {}) => Layer.succeed(FileSystem, FileSystem.of({
    exists: (path: string) => Effect.succeed(files[path] !== undefined),
    readFile: (path: string) => Effect.succeed(files[path] || ''),
    writeFile: (path: string, content: string) => Effect.sync(() => { files[path] = content; }),
    mkdir: (path: string) => Effect.succeed(undefined),
    rm: (path: string) => Effect.sync(() => { delete files[path]; }),
    writeFileBytes: (path: string, content: Uint8Array) =>
      Effect.sync(() => { files[path] = new TextDecoder().decode(content); }),
  } as any));

  const MockHttp = (keyContent: string) => Layer.succeed(HttpService, HttpService.of({
    downloadString: (url: string) => Effect.succeed(keyContent),
    downloadBytes: (url: string) => Effect.succeed(new TextEncoder().encode(keyContent)),
  } as any));

  const MockExec = (commands: string[] = []) => Layer.succeed(SystemCommand, SystemCommand.of({
    run: (cmd: string) => {
      commands.push(cmd);
      return Effect.succeed('');
    },
    execFile: (file, args, opts) => {
      commands.push([file, ...args].join(' ') + (opts?.stdin !== undefined ? ' <stdin' : ''));
      return Effect.succeed('');
    },
  }));

  it('should add a repository and download key', async () => {
    const commands: string[] = [];
    const files: Record<string, string> = {};
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'docker',
      uri: 'https://download.docker.com/linux/ubuntu',
      distribution: 'focal',
      components: ['stable'],
      key: 'https://download.docker.com/linux/ubuntu/gpg'
    });

    const keyContent = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n...';

    await Effect.runPromise(
      res.apply().pipe(
        Effect.provide(MockPlatform),
        Effect.provide(MockFS(files)),
        Effect.provide(MockHttp(keyContent)),
        Effect.provide(MockExec(commands))
      )
    );

    expect(files['/etc/apt/sources.list.d/docker.list']).toContain('[signed-by=/etc/apt/keyrings/docker.gpg]');
    expect(commands).toContain('gpg --batch --yes --dearmor --output /etc/apt/keyrings/docker.gpg <stdin');
    expect(commands.some((c) => c.includes('/tmp/'))).toBe(false);
    expect(commands.some((c) => c.startsWith('apt-get update'))).toBe(true);
  });

  it('should remove a repository when state is absent', async () => {
    const commands: string[] = [];
    const files: Record<string, string> = {
      '/etc/apt/sources.list.d/docker.list': '...',
      '/etc/apt/keyrings/docker.gpg': '...'
    };
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'docker',
      uri: 'https://download.docker.com/linux/ubuntu',
      distribution: 'focal',
      components: ['stable'],
      state: 'absent'
    });

    await Effect.runPromise(
      res.apply().pipe(
        Effect.provide(MockPlatform),
        Effect.provide(MockFS(files)),
        Effect.provide(MockHttp('')),
        Effect.provide(MockExec(commands))
      )
    );

    expect(files['/etc/apt/sources.list.d/docker.list']).toBeUndefined();
    expect(files['/etc/apt/keyrings/docker.gpg']).toBeUndefined();
    expect(commands.some((c) => c.startsWith('apt-get update'))).toBe(true);
  });

  it('allows aptRepository on Pop!_OS', async () => {
    const PopPlatform = Layer.succeed(
      PlatformService,
      PlatformService.of({
        get: () =>
          Effect.succeed({
            os: 'linux',
            distro: 'pop',
            distroLike: ['ubuntu', 'debian'],
          } as any),
      }),
    );
    const commands: string[] = [];
    const files: Record<string, string> = {};
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'docker',
      uri: 'https://download.docker.com/linux/ubuntu',
      distribution: 'jammy',
      components: ['stable'],
    });

    await Effect.runPromise(
      res.apply().pipe(
        Effect.provide(PopPlatform),
        Effect.provide(MockFS(files)),
        Effect.provide(MockHttp('')),
        Effect.provide(MockExec(commands)),
      ),
    );

    expect(files['/etc/apt/sources.list.d/docker.list']).toContain('jammy');
  });

  it('should have concurrencyKey as pkg-manager-system', () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'docker',
      uri: 'https://download.docker.com/linux/ubuntu',
      distribution: 'jammy',
      components: ['stable'],
    });

    expect(res.concurrencyKey).toBe('pkg-manager-system');
  });

  it('should copy binary OpenPGP keys directly without gpg dearmor', async () => {
    const commands: string[] = [];
    const files: Record<string, string> = {};
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'github-cli',
      uri: 'https://cli.github.com/packages',
      distribution: 'stable',
      components: ['main'],
      key: 'https://cli.github.com/packages/githubcli-archive-keyring.gpg',
    });

    // Binary data (starts with OpenPGP packet tag, not ASCII armor)
    const binaryKey = String.fromCharCode(0x99, 0x01, 0x00);

    await Effect.runPromise(
      res.apply().pipe(
        Effect.provide(MockPlatform),
        Effect.provide(MockFS(files)),
        Effect.provide(MockHttp(binaryKey)),
        Effect.provide(MockExec(commands)),
      ),
    );

    expect(files['/etc/apt/keyrings/github-cli.gpg']).toBe(binaryKey);
    expect(commands.some((c) => c.includes('gpg --dearmor'))).toBe(false);
  });

  it('leaves other sources.list.d files alone, even with an unreadable keyring', async () => {
    const commands: string[] = [];
    const files: Record<string, string> = {
      '/etc/apt/sources.list.d': '',
      '/etc/apt/sources.list.d/someone-else.list': 'deb [signed-by=/usr/share/keyrings/other.gpg] https://example.com stable main',
    };
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'good-repo',
      uri: 'https://example.com/good',
      distribution: 'stable',
      components: ['main'],
    });

    const NoGpgExec = Layer.succeed(SystemCommand, SystemCommand.of({
      run: () => Effect.succeed(''),
      execFile: (file, args) => {
        commands.push([file, ...args].join(' '));
        // As on a slim image without gpg installed.
        if (file === 'gpg') return Effect.fail(new Error('gpg: command not found'));
        return Effect.succeed('');
      },
    }));

    await Effect.runPromise(
      res.apply().pipe(
        Effect.provide(MockPlatform),
        Effect.provide(MockFS(files)),
        Effect.provide(MockHttp('')),
        Effect.provide(NoGpgExec),
      ),
    );

    expect(files['/etc/apt/sources.list.d/someone-else.list']).toBeDefined();
    expect(commands.some((c) => c.startsWith('apt-get update'))).toBe(true);
  });

  it('runs a plain apt-get update without disabling Valid-Until checks', async () => {
    const commands: [string, string[]][] = [];
    const files: Record<string, string> = {};
    const app = new App();
    const stack = new Stack(app, 'test');
    const res = new AptRepositoryResource(stack, 'test-repo', {
      name: 'skew-test',
      uri: 'https://example.com',
      distribution: 'stable',
      components: ['main'],
    });

    const CustomExec = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          commands.push([file, args]);
          return Effect.succeed('');
        },
      }),
    );

    await Effect.runPromise(
      res.apply().pipe(
        Effect.provide(MockPlatform),
        Effect.provide(MockFS(files)),
        Effect.provide(MockHttp('')),
        Effect.provide(CustomExec),
      ),
    );

    const aptUpdate = commands.find(([file]) => file === 'apt-get');
    expect(aptUpdate).toBeDefined();
    expect(aptUpdate?.[1]).toEqual(['update']);
  });
});
