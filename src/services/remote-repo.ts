import * as p from '@clack/prompts';
import { Context, Effect, Layer } from 'effect';
import pc from 'picocolors';
import { SystemCommand } from './exec';

export interface RemoteRepoService {
  readonly resolve: (identifier: string) => Effect.Effect<string, Error>;
  readonly clone: (url: string, destination: string) => Effect.Effect<void, Error>;
  readonly isRemote: (identifier: string) => boolean;
}

export const RemoteRepoService = Context.GenericTag<RemoteRepoService>('RemoteRepoService');

/**
 * Loading a remote braseh.ts runs its code with the user's permissions, for check as much as apply.
 * Ask first unless --yes or BRASEH_YES=1.
 */
export function confirmRemoteConfig(url: string, yes?: boolean): Effect.Effect<void, Error> {
  if (yes || process.env.BRASEH_YES === '1') return Effect.void;
  return Effect.promise(() =>
    p.confirm({
      message: `Loading remote configuration from ${pc.yellow(url)} runs its code on this machine. Do you trust this repository?`,
      initialValue: false,
    }),
  ).pipe(
    Effect.flatMap((confirmed) =>
      confirmed === true ? Effect.void : Effect.fail(new Error('Remote configuration cancelled by user.')),
    ),
  );
}

export const RemoteRepoServiceLive = Layer.effect(
  RemoteRepoService,
  Effect.gen(function* () {
    const exec = yield* SystemCommand;

    return RemoteRepoService.of({
      isRemote: (identifier) => {
        if (identifier.includes('://')) return true;
        const parts = identifier.split('/');
        if (!identifier.startsWith('.') && !identifier.startsWith('/') && parts.length === 2 && parts[0] && parts[1]) return true;
        return false;
      },
      resolve: (identifier) =>
        Effect.sync(() => {
          if (identifier.includes('://')) {
            return identifier;
          }
          if (identifier.split('/').length === 2) {
            return `https://github.com/${identifier}.git`;
          }
          throw new Error(`Invalid repository identifier: ${identifier}`);
        }),
      // argv, not a shell string: a URL with ; or & must stay one argument.
      clone: (url, destination) =>
        exec.execFile('git', ['clone', '--', url, destination]).pipe(Effect.asVoid),
    });
  })
);
