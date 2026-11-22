import { Effect } from 'effect';
import { Resource, Component } from '../core/component';
import { FileSystem } from '../services/fs';
import { dirname } from 'node:path';
import { isPlainObject, SecretToken } from '../core/secret';
import { SecretManager } from '../services/secrets-manager';
import { TemplateService } from '../services/template';
import { hashConfig } from '../core/hash';

export interface FileResourceProps {
  path: string;
  content: string | SecretToken;
  vars?: Record<string, any>;
  mode?: number;
  uid?: number;
  gid?: number;
  dependsOn?: Component[];
  become?: boolean | string;
  retries?: number;
  retryDelay?: number;
}

/** Swap each secret('NAME') inside template vars for its value, so Mustache never renders "Secret(NAME)". */
function resolveSecrets(value: unknown, sm: SecretManager): Effect.Effect<unknown, Error> {
  if (value instanceof SecretToken) return sm.get(value.name);
  if (Array.isArray(value)) return Effect.forEach(value, (item) => resolveSecrets(item, sm));
  if (isPlainObject(value)) {
    return Effect.forEach(Object.entries(value), ([key, item]) =>
      Effect.map(resolveSecrets(item, sm), (resolved) => [key, resolved] as const),
    ).pipe(Effect.map(Object.fromEntries));
  }
  return Effect.succeed(value);
}

export class FileResource extends Resource {
  override readonly kind = 'file' as const;
  constructor(scope: Component, id: string, override readonly props: FileResourceProps) {
    super(scope, id, props);
  }

  hash() {
    return hashConfig(this.props);
  }

  apply() {
    return Effect.gen(this, function* () {
      const fs = yield* FileSystem;
      const sm = yield* SecretManager;
      const tpl = yield* TemplateService;
      
      let content: string;
      if (this.props.content instanceof SecretToken) {
        content = yield* sm.get(this.props.content.name);
      } else {
        content = this.props.content;
      }

      if (this.props.vars) {
        content = yield* tpl.render(content, yield* resolveSecrets(this.props.vars, sm));
      }

      yield* fs.mkdir(dirname(this.props.path), { become: this.props.become });
      // mode goes into the write so secret content is never on disk with looser permissions.
      yield* fs.writeFile(this.props.path, content, { become: this.props.become, mode: this.props.mode });

      // Exact mode: the create-time mode above is filtered by the umask.
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