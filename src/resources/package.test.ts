import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { App, Stack } from '../core/app';
import { PackageResource } from './package';
import { SystemCommand } from '../services/exec';
import { PlatformService } from '../services/platform';

describe('PackageResource', () => {
  const PlatformMock = Layer.succeed(
    PlatformService,
    PlatformService.of({
      get: () => Effect.succeed({ os: 'darwin', arch: 'arm64' })
    })
  );

  it('should execute install if not already installed', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    
    const executedCommands: [string, string[]][] = [];
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          executedCommands.push([file, args]);
          if (file === 'brew' && args[0] === 'list') return Effect.fail(new Error('Not found'));
          return Effect.succeed('');
        },
      })
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', {
      name: 'neovim',
      manager: 'brew',
    });

    await Effect.runPromise(
      pkgRes.apply().pipe(
        Effect.provide(SystemCommandMock),
        Effect.provide(PlatformMock)
      )
    );
    
    expect(executedCommands).toContainEqual(['brew', ['install', 'neovim']]);
  });

  it('should execute the correct uninstall command on destroy', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    
    let executedCommand: [string, string[]] | undefined;
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          executedCommand = [file, args];
          return Effect.succeed('');
        },
      })
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', {
      name: 'neovim',
      manager: 'brew',
    });

    await Effect.runPromise(
      pkgRes.destroy().pipe(
        Effect.provide(SystemCommandMock),
        Effect.provide(PlatformMock)
      )
    );
    
    expect(executedCommand).toEqual(['brew', ['uninstall', 'neovim']]);
  });

  it('should infer the manager from the platform if not specified', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    
    const executedCommands: [string, string[]][] = [];
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          executedCommands.push([file, args]);
          if (file === 'brew' && args[0] === 'list') return Effect.fail(new Error('Not found'));
          return Effect.succeed('');
        },
      })
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', {
      name: 'neovim',
    });

    await Effect.runPromise(
      pkgRes.apply().pipe(
        Effect.provide(SystemCommandMock),
        Effect.provide(PlatformMock)
      )
    );
    
    expect(executedCommands).toContainEqual(['brew', ['install', 'neovim']]);
  });

  it('should skip install if already installed on the system', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    
    const executedCommands: [string, string[]][] = [];
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          executedCommands.push([file, args]);
          if (file === 'brew' && args[0] === 'list') return Effect.succeed('neovim 0.9.0');
          return Effect.succeed('');
        },
      })
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', {
      name: 'neovim',
      manager: 'brew',
    });

    await Effect.runPromise(
      pkgRes.apply().pipe(
        Effect.provide(SystemCommandMock),
        Effect.provide(PlatformMock)
      )
    );
    
    expect(executedCommands).not.toContainEqual(['brew', ['install', 'neovim']]);
  });

  it('should install a specific version if requested', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    
    const executedCommands: [string, string[]][] = [];
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          executedCommands.push([file, args]);
          if (file === 'brew' && args[0] === 'list') return Effect.fail(new Error('Not found'));
          return Effect.succeed('');
        },
      })
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', {
      name: 'neovim',
      manager: 'brew',
      version: '0.9.0'
    });

    await Effect.runPromise(
      pkgRes.apply().pipe(
        Effect.provide(SystemCommandMock),
        Effect.provide(PlatformMock)
      )
    );
    
    expect(executedCommands).toContainEqual(['brew', ['install', 'neovim@0.9.0']]);
  });

  it('should pass a package name with shell metacharacters as a single argv entry', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');

    const executedCommands: [string, string[]][] = [];
    let runUsed = false;
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => {
          runUsed = true;
          return Effect.succeed('');
        },
        execFile: (file, args) => {
          executedCommands.push([file, args]);
          if (file === 'brew' && args[0] === 'list') return Effect.fail(new Error('Not found'));
          return Effect.succeed('');
        },
      })
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', {
      name: 'neovim; touch /tmp/pwned',
      manager: 'brew',
    });

    await Effect.runPromise(
      pkgRes.apply().pipe(
        Effect.provide(SystemCommandMock),
        Effect.provide(PlatformMock)
      )
    );

    const install = executedCommands.find(([file, args]) => file === 'brew' && args[0] === 'install');
    expect(install?.[1]).toEqual(['install', 'neovim; touch /tmp/pwned']);
    expect(runUsed).toBe(false);
  });

  it('infers apt on Pop!_OS', async () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    const executedCommands: [string, string[]][] = [];
    const PopPlatform = Layer.succeed(
      PlatformService,
      PlatformService.of({
        get: () =>
          Effect.succeed({
            os: 'linux',
            arch: 'x64',
            distro: 'pop',
            distroLike: ['ubuntu', 'debian'],
          }),
      }),
    );
    const SystemCommandMock = Layer.succeed(
      SystemCommand,
      SystemCommand.of({
        run: () => Effect.succeed(''),
        execFile: (file, args) => {
          executedCommands.push([file, args]);
          if (file === 'dpkg') return Effect.fail(new Error('not installed'));
          return Effect.succeed('');
        },
      }),
    );

    const pkgRes = new PackageResource(stack, 'my-pkg', { name: 'git' });
    await Effect.runPromise(
      pkgRes.apply().pipe(Effect.provide(SystemCommandMock), Effect.provide(PopPlatform)),
    );

    expect(executedCommands).toContainEqual(['apt-get', ['install', '-y', 'git']]);
  });

  it('maps system package managers to pkg-manager-system concurrencyKey', () => {
    const app = new App();
    const stack = new Stack(app, 'test');
    const pDefault = new PackageResource(stack, 'p1', { name: 'git' });
    const pApt = new PackageResource(stack, 'p2', { name: 'git', manager: 'apt' });
    const pBrew = new PackageResource(stack, 'p3', { name: 'git', manager: 'brew' });
    const pPacman = new PackageResource(stack, 'p4', { name: 'git', manager: 'pacman' });
    const pCargo = new PackageResource(stack, 'p5', { name: 'ripgrep', manager: 'cargo' });

    expect(pDefault.concurrencyKey).toBe('pkg-manager-system');
    expect(pApt.concurrencyKey).toBe('pkg-manager-system');
    expect(pBrew.concurrencyKey).toBe('pkg-manager-system');
    expect(pPacman.concurrencyKey).toBe('pkg-manager-system');
    expect(pCargo.concurrencyKey).toBe('pkg-manager-cargo');
  });

  const recordExec = (commands: [string, string[]][], respond: (file: string, args: string[]) => string | Error) =>
    Layer.succeed(SystemCommand, SystemCommand.of({
      run: () => Effect.succeed(''),
      execFile: (file, args) => {
        commands.push([file, args]);
        const out = respond(file, args);
        return out instanceof Error ? Effect.fail(out) : Effect.succeed(out);
      },
    }));

  it('reinstalls an apt package that was removed but left config files', async () => {
    const stack = new Stack(new App(), 'test');
    const commands: [string, string[]][] = [];
    const res = new PackageResource(stack, 'pkg:htop', { name: 'htop', manager: 'apt' });
    await Effect.runPromise(res.apply().pipe(
      Effect.provide(recordExec(commands, (file) =>
        file === 'dpkg' ? 'Package: htop\nStatus: deinstall ok config-files\nVersion: 3.3.0-4' : '')),
      Effect.provide(PlatformMock),
    ));
    expect(commands).toContainEqual(['apt-get', ['install', '-y', 'htop']]);
    expect(res.preexisting).toBe(false);
  });

  it('marks an already-installed package as preexisting', async () => {
    const stack = new Stack(new App(), 'test');
    const res = new PackageResource(stack, 'pkg:git', { name: 'git', manager: 'apt' });
    await Effect.runPromise(res.apply().pipe(
      Effect.provide(recordExec([], (file) => (file === 'dpkg' ? 'Package: git\nStatus: install ok installed\n' : ''))),
      Effect.provide(PlatformMock),
    ));
    expect(res.preexisting).toBe(true);
  });

  it('finds bun globals by package name and version, not by binary name', async () => {
    const listing = '/home/u/.bun/install/global node_modules (2)\n├── @biomejs/biome@2.5.12\n└── typescript@5.4.5';
    const run = async (name: string, version?: string) => {
      const commands: [string, string[]][] = [];
      const stack = new Stack(new App(), 'test');
      await Effect.runPromise(new PackageResource(stack, `pkg:${name}`, { name, version, manager: 'bun' }).apply().pipe(
        Effect.provide(recordExec(commands, (file, args) => (args[0] === 'pm' ? listing : ''))),
        Effect.provide(PlatformMock),
      ));
      return commands.some(([file, args]) => file === 'bun' && args[0] === 'add');
    };
    expect(await run('typescript')).toBe(false);
    expect(await run('@biomejs/biome')).toBe(false);
    expect(await run('typescript', '5.4.5')).toBe(false);
    expect(await run('typescript', '5.5.0')).toBe(true);
    expect(await run('script')).toBe(true);
  });

  it("uninstalls an installed package when state is 'absent', and does nothing once it is gone", async () => {
    const run = async (dpkgStatus: string) => {
      const commands: [string, string[]][] = [];
      const stack = new Stack(new App(), 'test');
      await Effect.runPromise(new PackageResource(stack, 'pkg:toilet', { name: 'toilet', manager: 'apt', state: 'absent' }).apply().pipe(
        Effect.provide(recordExec(commands, (file) => (file === 'dpkg' ? `Package: toilet\nStatus: ${dpkgStatus}\n` : ''))),
        Effect.provide(PlatformMock),
      ));
      return commands.filter(([file]) => file === 'apt-get');
    };
    expect(await run('install ok installed')).toEqual([['apt-get', ['remove', '-y', 'toilet']]]);
    expect(await run('deinstall ok config-files')).toEqual([]);
  });

  it("does nothing on destroy of a state: 'absent' declaration", async () => {
    const commands: [string, string[]][] = [];
    const stack = new Stack(new App(), 'test');
    await Effect.runPromise(new PackageResource(stack, 'pkg:toilet', { name: 'toilet', manager: 'apt', state: 'absent' }).destroy().pipe(
      Effect.provide(recordExec(commands, () => '')),
      Effect.provide(PlatformMock),
    ));
    expect(commands).toEqual([]);
  });
});
