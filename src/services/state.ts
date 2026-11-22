import { Context, Effect, Layer } from 'effect';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { BrasehError } from '../core/errors';
import { FileSystem } from './fs';
import { dirname, join } from 'node:path';

export interface ResourceState {
  hash: string;
  kind: string;
  metadata: Record<string, unknown>;
}

export type AppState = Record<string, ResourceState>;

export interface StateService {
  readonly setPath: (path: string) => Effect.Effect<void>;
  readonly load: () => Effect.Effect<AppState, Error>;
  readonly save: (state: AppState) => Effect.Effect<void, Error>;
}

export const StateService = Context.GenericTag<StateService>('StateService');

export function parseState(content: string, path: string): Effect.Effect<AppState, BrasehError> {
  return Effect.try({
    try: () => JSON.parse(content) as AppState,
    catch: (error) =>
      new BrasehError(
        `State file ${path} is not valid JSON: ${String(error)}`,
        'Restore it from a backup. Deleting it makes braseh forget what it applied, so it will not destroy those resources later.',
      ),
  });
}

export const StateServiceLive = Layer.effect(
  StateService,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    let statePath = join(process.cwd(), '.braseh/state.json');

    return StateService.of({
      setPath: (path) => Effect.sync(() => { statePath = path; }),
      load: () =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(statePath);
          if (!exists) return {};
          const content = yield* fs.readFile(statePath);
          return yield* parseState(content, statePath);
        }),
      save: (state) =>
        Effect.tryPromise({
          // Write a 0600 temp file and rename it over, so a crash mid-write never leaves half a state file.
          try: async () => {
            await mkdir(dirname(statePath), { recursive: true });
            const temp = `${statePath}.${process.pid}.tmp`;
            await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
            await rename(temp, statePath);
          },
          catch: (error) => new Error(`Failed to save state ${statePath}: ${String(error)}`),
        }),
    });
  })
);
