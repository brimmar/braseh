import { Effect, Option } from 'effect';
import { Resource, Component } from '../core/component';
import { HttpService } from '../services/http';
import { FileSystem, resolvePath } from '../services/fs';
import { DryRun } from '../services/dry-run';
import { hashConfig } from '../core/hash';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RemoteFileResourceProps {
  url: string;
  path: string;
  sha256?: string;
  mode?: number;
  uid?: number;
  gid?: number;
  dependsOn?: Component[];
  become?: boolean | string;
  retries?: number;
  retryDelay?: number;
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class RemoteFileResource extends Resource {
  override readonly kind = 'remote' as const;
  constructor(scope: Component, id: string, override readonly props: RemoteFileResourceProps) {
    super(scope, id, props);
  }

  hash() {
    return hashConfig(this.props);
  }

  apply() {
    return Effect.gen(this, function* () {
      const http = yield* HttpService;
      const fs = yield* FileSystem;
      const dryRun = Option.exists(yield* Effect.serviceOption(DryRun), (enabled) => enabled);
      const expected = this.props.sha256?.toLowerCase();

      // ponytail: reads the current file with node:fs because FileSystem has no byte reader,
      // and only when sha256 is pinned. Upgrade: add readFileBytes to FileSystem (and its test mocks)
      // and store the ETag in state to skip unpinned downloads too.
      const current =
        expected === undefined
          ? undefined
          : yield* Effect.promise(() => readFile(resolvePath(this.props.path)).catch(() => undefined));

      if (current === undefined || sha256Of(current) !== expected) {
        // Dry run only reports the write; it does not fetch.
        const bytes = dryRun ? new Uint8Array() : yield* http.downloadBytes(this.props.url);

        if (!dryRun && expected !== undefined) {
          const actualHash = sha256Of(bytes);
          if (actualHash !== expected) {
            return yield* Effect.fail(
              new Error(`Hash mismatch for ${this.props.url}. Expected ${expected}, got ${actualHash}`),
            );
          }
        }

        yield* fs.mkdir(dirname(this.props.path), { become: this.props.become });
        yield* fs.writeFileBytes(this.props.path, bytes, { become: this.props.become, mode: this.props.mode });
      }

      if (this.props.mode !== undefined) {
        yield* fs.chmod(this.props.path, this.props.mode, { become: this.props.become });
      }

      if (this.props.uid !== undefined || this.props.gid !== undefined) {
        yield* fs.chown(this.props.path, this.props.uid ?? -1, this.props.gid ?? -1, { become: this.props.become });
      }
    });
  }

  destroy() {
    return Effect.gen(this, function* () {
      const fs = yield* FileSystem;
      yield* fs.unlink(this.props.path, { become: this.props.become });
    });
  }
}
