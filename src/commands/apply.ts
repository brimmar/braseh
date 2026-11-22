import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { Effect, FiberRef, Layer } from "effect";
import pc from "picocolors";
import { flatten } from "../core/component";
import { loadConfig } from "../core/loader";
import { Runner, RunnerLive } from "../core/runner";
import { checkPathPermission, setupSudoSession } from "../core/sudo";
import { DryRun } from "../services/dry-run";
import {
  currentResourceTag,
  SystemCommand,
  createSystemCommandLive,
} from "../services/exec";
import { FileSystem, FileSystemLive } from "../services/fs";
import { HttpServiceLive } from "../services/http";
import { PlatformServiceLive } from "../services/platform";
import {
  confirmRemoteConfig,
  RemoteRepoService,
  RemoteRepoServiceLive,
} from "../services/remote-repo";
import { SecretStoreLive } from "../services/secrets";
import { SecretManager, SecretManagerLive } from "../services/secrets-manager";
import {
  parseState,
  StateService,
  StateServiceLive,
} from "../services/state";
import { TempDirService, TempDirServiceLive } from "../services/temp-dir";
import { TemplateServiceLive } from "../services/template";
import {
  ValidationService,
  ValidationServiceLive,
} from "../services/validation";

export interface ApplyOptions {
  dryRun?: boolean;
  yes?: boolean;
  verbose?: boolean;
  json?: boolean;
}

export interface ApplyResult {
  success: boolean;
  command: "apply";
  config: string;
  dryRun: boolean;
  summary: {
    created: number;
    updated: number;
    deleted: number;
    converged: number;
    durationSeconds: number;
  };
  resources: Array<{
    id: string;
    kind: string;
    status: "created" | "updated" | "converged" | "deleted";
    durationSeconds?: number;
  }>;
}

/**
 * State lives with the config it describes, never in the shell's cwd. Otherwise applying a second
 * config from the first one's directory would destroy everything the first one created.
 */
export function statePathFor(config: { dir: string } | { url: string }): string {
  if ("dir" in config) return join(config.dir, ".braseh", "state.json");
  const id = createHash("sha256").update(config.url).digest("hex").slice(0, 16);
  return join(homedir(), ".braseh", "remote", id, "state.json");
}

/** Live reads; mutating methods log and do not touch disk. */
export function dryRunFileSystem(
  live: FileSystem,
  options?: { json?: boolean },
): FileSystem {
  const log = (msg: string) => {
    if (!options?.json) {
      p.log.info(pc.gray(msg));
    }
  };
  return FileSystem.of({
    readFile: (path, opt) => live.readFile(path, opt),
    exists: (path, opt) => live.exists(path, opt),
    writeFile: (path, _content, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would write file: ${path}`);
      }),
    writeFileBytes: (path, _content, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would write bytes: ${path}`);
      }),
    mkdir: (path, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would create directory: ${path}`);
      }),
    symlink: (target, path, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would create symlink: ${path} -> ${target}`);
      }),
    rm: (path, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would remove: ${path}`);
      }),
    rmdir: (path, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would rmdir: ${path}`);
      }),
    unlink: (path, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would unlink: ${path}`);
      }),
    chmod: (path, mode, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would chmod: ${path} to ${mode}`);
      }),
    chown: (path, uid, gid, opt) =>
      Effect.sync(() => {
        checkPathPermission(path, opt);
        log(`[DRY RUN] Would chown: ${path} to ${uid}:${gid}`);
      }),
  });
}

function dryRunSystemCommand(
  live: SystemCommand,
  verbose?: boolean,
  json?: boolean,
): SystemCommand {
  const log = (msg: string) => {
    if (!json) {
      p.log.info(pc.gray(msg));
    }
  };
  return SystemCommand.of({
    execFile: (file, args, options) => {
      if (options?.intent === "read") {
        return live.execFile(file, args, { ...options, become: undefined });
      }
      return Effect.gen(function* () {
        const tag = yield* FiberRef.get(currentResourceTag);
        const prefix = tag ? pc.cyan(tag) + " " : "";
        log(`${prefix}[DRY RUN] Would execute: ${file} ${args.join(" ")}`);
        if (verbose && options?.cwd && !json) {
          p.log.info(prefix + pc.dim(`          cwd: ${options.cwd}`));
        }
        return "";
      });
    },
    run: (command, options) => {
      if (options?.intent === "read") {
        return live.run(command, { ...options, become: undefined });
      }
      return Effect.gen(function* () {
        const tag = yield* FiberRef.get(currentResourceTag);
        const prefix = tag ? pc.cyan(tag) + " " : "";
        log(`${prefix}[DRY RUN] Would run: ${command}`);
        if (verbose && options?.cwd && !json) {
          p.log.info(prefix + pc.dim(`          cwd: ${options.cwd}`));
        }
        return "";
      });
    },
  });
}

export async function brasehApply(
  configPath: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const isVerbose = Boolean(options.verbose && !options.json);
  const BaseExecLayer = createSystemCommandLive({ verbose: isVerbose });

  const FSLayer = options.dryRun
    ? Layer.effect(
        FileSystem,
        Effect.gen(function* () {
          const live = yield* FileSystem;
          return dryRunFileSystem(live, { json: options.json });
        }),
      ).pipe(Layer.provide(FileSystemLive.pipe(Layer.provide(BaseExecLayer))))
    : FileSystemLive;

  const ExecLayer = options.dryRun
    ? Layer.effect(
        SystemCommand,
        Effect.gen(function* () {
          const live = yield* SystemCommand;
          return dryRunSystemCommand(live, options.verbose, options.json);
        }),
      ).pipe(Layer.provide(BaseExecLayer))
    : BaseExecLayer;

  const StateLayer = options.dryRun
    ? Layer.effect(
        StateService,
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          let statePath = join(process.cwd(), ".braseh/state.json");
          return StateService.of({
            setPath: (path) =>
              Effect.sync(() => {
                statePath = path;
              }),
            load: () =>
              Effect.gen(function* () {
                const exists = yield* fs.exists(statePath);
                if (!exists) return {};
                const content = yield* fs.readFile(statePath);
                return yield* parseState(content, statePath);
              }),
            save: () => Effect.void,
          });
        }),
      )
    : StateServiceLive;

  const program = Effect.gen(function* (_) {
    const remoteRepo = yield* _(RemoteRepoService);
    const tempDir = yield* _(TempDirService);
    const runner = yield* _(Runner);
    const secretManager = yield* _(SecretManager);
    const validator = yield* _(ValidationService);
    const stateService = yield* _(StateService);

    if (remoteRepo.isRemote(configPath)) {
      const url = yield* _(remoteRepo.resolve(configPath));
      yield* _(confirmRemoteConfig(url, options.yes));
      yield* _(stateService.setPath(statePathFor({ url })));

      return yield* _(
        tempDir.use((dir) =>
          Effect.gen(function* (_) {
            if (!options.json) {
              const s = p.spinner();
              s.start(`Cloning ${url}...`);
              yield* _(remoteRepo.clone(url, dir));
              s.stop(`Cloned to temporary directory.`);
            } else {
              yield* _(remoteRepo.clone(url, dir));
            }

            let finalPath = join(dir, "braseh.ts");
            if (!existsSync(finalPath)) {
              if (existsSync(join(dir, "braseh", "braseh.ts"))) {
                finalPath = join(dir, "braseh", "braseh.ts");
              } else if (existsSync(join(dir, ".braseh", "braseh.ts"))) {
                finalPath = join(dir, ".braseh", "braseh.ts");
              }
            }

            const configDir = dirname(finalPath);
            const vaultCandidate = existsSync(join(dir, ".braseh", "vault"))
              ? join(dir, ".braseh", "vault")
              : join(configDir, ".braseh", "vault");
            yield* _(
              secretManager.setPaths({
                secretsFile: vaultCandidate,
                masterKeyFile: join(homedir(), ".braseh_key"),
              }),
            );

            const { app, config } = yield* _(
              Effect.promise(() => loadConfig(finalPath)),
            );

            if (!options.json) {
              p.log.step(
                pc.cyan(
                  `Applying configuration: ${config.name}${options.dryRun ? " (DRY RUN)" : ""}`,
                ),
              );
            }
            yield* _(validator.validate(app));
            const rawResources = flatten(app);
            const sudoSession = yield* _(
              Effect.sync(() =>
                setupSudoSession(rawResources, { dryRun: options.dryRun }),
              ),
            );
            const report = yield* _(
              Effect.acquireUseRelease(
                Effect.succeed(sudoSession),
                () =>
                  runner.run(app, {
                    silent: options.json,
                    verbose: isVerbose,
                  }),
                (session) => Effect.sync(() => session.cleanup()),
              ),
            );
            return {
              success: true,
              command: "apply" as const,
              config: config.name,
              dryRun: Boolean(options.dryRun),
              summary: {
                created: report.created,
                updated: report.updated,
                deleted: report.deleted,
                converged: report.converged,
                durationSeconds: report.durationSeconds,
              },
              resources: report.resources,
            };
          }),
        ),
      );
    } else {
      const resolved = resolve(configPath);
      const configDir = dirname(resolved);
      yield* _(stateService.setPath(statePathFor({ dir: configDir })));
      yield* _(
        secretManager.setPaths({
          secretsFile: join(configDir, ".braseh", "vault"),
          masterKeyFile: join(homedir(), ".braseh_key"),
        }),
      );

      const { app, config } = yield* _(
        Effect.promise(() => loadConfig(configPath)),
      );
      if (!options.json) {
        p.log.step(
          pc.cyan(
            `Applying configuration: ${config.name}${options.dryRun ? " (DRY RUN)" : ""}`,
          ),
        );
      }
      yield* _(validator.validate(app));
      const rawResources = flatten(app);
      const sudoSession = yield* _(
        Effect.sync(() =>
          setupSudoSession(rawResources, { dryRun: options.dryRun }),
        ),
      );
      const report = yield* _(
        Effect.acquireUseRelease(
          Effect.succeed(sudoSession),
          () =>
            runner.run(app, {
              silent: options.json,
              verbose: isVerbose,
            }),
          (session) => Effect.sync(() => session.cleanup()),
        ),
      );
      return {
        success: true,
        command: "apply" as const,
        config: config.name,
        dryRun: Boolean(options.dryRun),
        summary: {
          created: report.created,
          updated: report.updated,
          deleted: report.deleted,
          converged: report.converged,
          durationSeconds: report.durationSeconds,
        },
        resources: report.resources,
      };
    }
  });

  const RemoteRepoLayer = RemoteRepoServiceLive.pipe(
    Layer.provide(BaseExecLayer),
  );
  const TempDirLayer = TempDirServiceLive.pipe(
    Layer.provide(FileSystemLive.pipe(Layer.provide(BaseExecLayer))),
  );

  const SecretManagerWithDeps = SecretManagerLive.pipe(
    Layer.provide(FSLayer),
    Layer.provide(SecretStoreLive),
  );
  const ValidationLayer = ValidationServiceLive.pipe(
    Layer.provide(SecretManagerWithDeps),
    Layer.provide(FSLayer),
  );

  const MainLayer = RunnerLive.pipe(
    Layer.provideMerge(RemoteRepoLayer),
    Layer.provideMerge(TempDirLayer),
    Layer.provideMerge(SecretManagerWithDeps),
    Layer.provideMerge(ValidationLayer),
    Layer.provideMerge(PlatformServiceLive),
    Layer.provideMerge(StateLayer),
    Layer.provideMerge(TemplateServiceLive),
    Layer.provideMerge(HttpServiceLive),
    Layer.provideMerge(SecretStoreLive),
    Layer.provideMerge(ExecLayer),
    Layer.provideMerge(FSLayer.pipe(Layer.provideMerge(ExecLayer))),
    Layer.provideMerge(
      options.dryRun ? Layer.succeed(DryRun, true) : Layer.empty,
    ),
  );

  return await Effect.runPromise(Effect.provide(program, MainLayer));
}
