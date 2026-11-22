import { Context, Effect, Layer, Option } from 'effect';
import * as NodeFS from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export interface WriteFileOptions {
  become?: boolean | string;
  mode?: number;
}

export interface FileSystem {
  readonly writeFile: (path: string, content: string, options?: WriteFileOptions) => Effect.Effect<void, Error>;
  readonly readFile: (path: string, options?: { become?: boolean | string }) => Effect.Effect<string, Error>;
  readonly exists: (path: string, options?: { become?: boolean | string }) => Effect.Effect<boolean, Error>;
  readonly mkdir: (path: string, options?: { become?: boolean | string }) => Effect.Effect<void, Error>;
  readonly symlink: (
    target: string,
    path: string,
    options?: { become?: boolean | string; force?: boolean },
  ) => Effect.Effect<void, Error>;
  readonly rm: (path: string, options?: { become?: boolean | string }) => Effect.Effect<void, Error>;
  readonly rmdir: (path: string, options?: { become?: boolean | string }) => Effect.Effect<void, Error>;
  readonly unlink: (path: string, options?: { become?: boolean | string }) => Effect.Effect<void, Error>;
  readonly chmod: (path: string, mode: number, options?: { become?: boolean | string }) => Effect.Effect<void, Error>;
  readonly chown: (path: string, uid: number, gid: number, options?: { become?: boolean | string }) => Effect.Effect<void, Error>;
  readonly writeFileBytes: (
    path: string,
    content: Uint8Array,
    options?: WriteFileOptions,
  ) => Effect.Effect<void, Error>;
}

export const FileSystem = Context.GenericTag<FileSystem>('FileSystem');

import { SystemCommand } from './exec';

/**
 * Expand leading `~` to the current user's home directory.
 * Node.js filesystem APIs do not do shell-style tilde expansion, so we must
 * handle it explicitly — otherwise paths like `~/.config/nvim` are treated
 * as a literal directory starting with `~`.
 */
export function resolvePath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return `${homedir()}${p.slice(1)}`;
  return resolve(p);
}

function isIgnorableRmdirError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    if (code === 'ENOENT' || code === 'ENOTEMPTY') return true;
  }
  const msg = String(error).toLowerCase();
  return (
    msg.includes('no such file') ||
    msg.includes('not empty') ||
    msg.includes('directory not empty') ||
    msg.includes('enoent') ||
    msg.includes('enotempty')
  );
}

function isDirectoryUnlinkError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (String(error.code) === 'EISDIR') return true;
  }
  const msg = String(error).toLowerCase();
  return msg.includes('is a directory') || msg.includes('eisdir');
}

function isIgnorableUnlinkError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    if (code === 'ENOENT' || code === 'EISDIR') return true;
  }
  const msg = String(error).toLowerCase();
  return (
    msg.includes('no such file') ||
    msg.includes('enoent') ||
    isDirectoryUnlinkError(error)
  );
}

function destMode(options?: WriteFileOptions): number {
  if (options && options.mode !== undefined) {
    return options.mode;
  }
  return 0o644;
}


function namedBecomeUser(become: boolean | string | undefined): string | undefined {
  if (typeof become === 'string' && become !== 'root') {
    return become;
  }
  return undefined;
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Tighten an existing file before new content lands in it. A missing file is fine. */
async function chmodIfExists(path: string, mode: number | undefined): Promise<void> {
  if (mode === undefined) return;
  await NodeFS.chmod(path, mode).catch((error) => (isMissing(error) ? undefined : Promise.reject(error)));
}

function existingRefusal(path: string): Error {
  return new Error(
    `${path} already exists and is not a symlink. Move it away, or pass force: true to delete it and link in its place.`,
  );
}

function copyViaTemp(
  exec: SystemCommand,
  dest: string,
  content: string | Uint8Array,
  options?: WriteFileOptions,
) {
  const asRoot = { become: true as const };
  const asRootRead = { become: true as const, intent: 'read' as const };

  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const dir = await NodeFS.mkdtemp(join(tmpdir(), 'braseh-'));
        const temp = join(dir, 'file');
        await NodeFS.writeFile(temp, content, { mode: 0o600 });
        return { dir, temp };
      },
      catch: (error) => new Error(`Failed to write temp file: ${String(error)}`),
    }),
    ({ temp }) =>
      Effect.gen(function* () {
        const existed = yield* exec.execFile('test', ['-e', dest], asRootRead).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (existed) {
          // cp onto an existing file truncates it in place, so its mode, owner
          // and symlinks survive (install would reset them to 0644 root:root).
          if (options?.mode !== undefined) {
            yield* exec.execFile('chmod', [options.mode.toString(8), '--', dest], asRoot);
          }
          yield* exec.execFile('cp', ['--', temp, dest], asRoot);
          return;
        }
        // install -m sets dest mode in the same root step so a 0o600 file
        // is never world-readable between cp and chmod.
        yield* exec.execFile(
          'install',
          ['-m', destMode(options).toString(8), '--', temp, dest],
          asRoot,
        );
        const user = namedBecomeUser(options?.become);
        if (user) {
          yield* exec.execFile('chown', [`${user}:`, '--', dest], asRoot);
        }
      }),
    ({ dir }) => Effect.ignore(Effect.tryPromise(() => NodeFS.rm(dir, { recursive: true, force: true }))),
  );
}


export const FileSystemLive = Layer.effect(
  FileSystem,
  Effect.gen(function* () {
    const exec = yield* SystemCommand;

    const wrap = <A, E, R>(
      options: { become?: boolean | string } | undefined,
      nodeOp: () => Promise<A>,
      sudoOp: (exec: SystemCommand) => Effect.Effect<A, E, R>,
      errorMsg: (err: any) => string
    ): Effect.Effect<A, Error | E, R> => {
      if (options?.become) {
        return sudoOp(exec);
      }
      return Effect.tryPromise({
        try: nodeOp,
        catch: (error) => new Error(errorMsg(error)),
      });
    };

    return FileSystem.of({
      writeFile: (path, content, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          async () => {
            await chmodIfExists(resolved, options?.mode);
            await NodeFS.writeFile(
              resolved,
              content,
              options?.mode !== undefined
                ? { encoding: 'utf-8', mode: options.mode }
                : 'utf-8',
            );
          },
          (exec) => copyViaTemp(exec, resolved, content, options),
          (error) => `Failed to write file ${resolved}: ${String(error)}`
        );
      },
      writeFileBytes: (path, content, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          async () => {
            await chmodIfExists(resolved, options?.mode);
            await NodeFS.writeFile(
              resolved,
              content,
              options?.mode !== undefined ? { mode: options.mode } : undefined,
            );
          },
          (exec) => copyViaTemp(exec, resolved, content, options),
          (error) => `Failed to write file ${resolved}: ${String(error)}`
        );
      },
      readFile: (path, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          () => NodeFS.readFile(resolved, 'utf-8'),
          (exec) => exec.execFile('cat', ['--', resolved], { ...options, raw: true }),
          (error) => `Failed to read file ${resolved}: ${String(error)}`
        );
      },
      exists: (path, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          async () => {
            try {
              await NodeFS.access(resolved);
              return true;
            } catch {
              return false;
            }
          },
          (exec) =>
            exec.execFile('test', ['-e', resolved], options).pipe(
              Effect.map(() => true),
              Effect.catchAll(() => Effect.succeed(false))
            ),
          (error) => `Failed to check existence of ${resolved}: ${String(error)}`
        );
      },
      mkdir: (path, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          () => NodeFS.mkdir(resolved, { recursive: true }).then(() => undefined),
          (exec) => exec.execFile('mkdir', ['-p', '--', resolved], options).pipe(Effect.map(() => undefined)),
          (error) => `Failed to create directory ${resolved}: ${String(error)}`
        );
      },
      symlink: (target, path, options) => {
        const resolvedPath = resolvePath(path);
        const resolvedTarget =
          target === '~' || target.startsWith('~/') || target.startsWith('~\\')
            ? `${homedir()}${target.slice(1)}`
            : target;
        const asUser = { become: options?.become };
        return wrap(
          options,
          async () => {
            await NodeFS.mkdir(dirname(resolvedPath), { recursive: true });
            const current = await NodeFS.lstat(resolvedPath).catch((error) =>
              isMissing(error) ? undefined : Promise.reject(error),
            );
            if (current?.isSymbolicLink()) {
              if ((await NodeFS.readlink(resolvedPath)) === resolvedTarget) return;
              await NodeFS.unlink(resolvedPath);
            } else if (current) {
              if (!options?.force) throw existingRefusal(resolvedPath);
              await NodeFS.rm(resolvedPath, { recursive: true, force: true });
            }
            await NodeFS.symlink(resolvedTarget, resolvedPath);
          },
          (exec) =>
            Effect.gen(function* () {
              const current = yield* exec
                .execFile('readlink', ['--', resolvedPath], { ...asUser, intent: 'read' })
                .pipe(Effect.option);
              if (Option.isSome(current)) {
                if (current.value === resolvedTarget) return;
              } else {
                const exists = yield* exec
                  .execFile('test', ['-e', resolvedPath], { ...asUser, intent: 'read' })
                  .pipe(
                    Effect.as(true),
                    Effect.orElseSucceed(() => false),
                  );
                if (exists) {
                  if (!options?.force) return yield* Effect.fail(existingRefusal(resolvedPath));
                  yield* exec.execFile('rm', ['-rf', '--', resolvedPath], asUser);
                }
              }
              yield* exec.execFile('mkdir', ['-p', '--', dirname(resolvedPath)], asUser);
              // -n: replace an existing link instead of following it into the directory it points at.
              yield* exec.execFile('ln', ['-sfn', '--', resolvedTarget, resolvedPath], asUser);
            }),
          (error) => `Failed to create symlink ${resolvedPath} -> ${resolvedTarget}: ${String(error)}`
        );
      },
      rm: (path, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          () => NodeFS.rm(resolved, { force: true, recursive: true }),
          (exec) => exec.execFile('rm', ['-rf', '--', resolved], options).pipe(Effect.map(() => undefined)),
          (error) => `Failed to remove ${resolved}: ${String(error)}`
        );
      },
      rmdir: (path, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          async () => {
            try {
              await NodeFS.rmdir(resolved);
            } catch (error) {
              if (isIgnorableRmdirError(error)) return;
              return Promise.reject(error);
            }
          },
          (exec) =>
            exec.execFile('rmdir', [resolved], options).pipe(
              Effect.map(() => undefined),
              Effect.catchAll((error) =>
                isIgnorableRmdirError(error) ? Effect.void : Effect.fail(error)
              ),
            ),
          (error) => `Failed to rmdir ${resolved}: ${String(error)}`
        );
      },
      unlink: (path, options) => {
        const resolved = resolvePath(path);
        const ignoreUnlinkError = (error: unknown): boolean => {
          if (!isIgnorableUnlinkError(error)) return false;
          if (isDirectoryUnlinkError(error)) {
            console.warn(`unlink ${resolved}: path is a directory; leaving it in place`);
          }
          return true;
        };
        return wrap(
          options,
          async () => {
            try {
              await NodeFS.unlink(resolved);
            } catch (error) {
              if (ignoreUnlinkError(error)) return;
              return Promise.reject(error);
            }
          },
          (exec) =>
            exec.execFile('rm', ['-f', '--', resolved], options).pipe(
              Effect.map(() => undefined),
              Effect.catchAll((error) =>
                ignoreUnlinkError(error) ? Effect.void : Effect.fail(error)
              ),
            ),
          (error) => `Failed to unlink ${resolved}: ${String(error)}`
        );
      },
      chmod: (path, mode, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          () => NodeFS.chmod(resolved, mode),
          (exec) =>
            exec.execFile('chmod', [mode.toString(8), '--', resolved], options).pipe(Effect.map(() => undefined)),
          (error) => `Failed to chmod ${resolved} to ${mode}: ${String(error)}`
        );
      },
      chown: (path, uid, gid, options) => {
        const resolved = resolvePath(path);
        return wrap(
          options,
          () => NodeFS.chown(resolved, uid, gid),
          (exec) =>
            // -1 leaves that id alone, like chown(2). `uid:` would also reset the group.
            exec
              .execFile('chown', [uid === -1 ? `:${gid}` : gid === -1 ? `${uid}` : `${uid}:${gid}`, '--', resolved], options)
              .pipe(Effect.map(() => undefined)),
          (error) => `Failed to chown ${resolved} to ${uid}:${gid}: ${String(error)}`
        );
      },
    });
  })
);
