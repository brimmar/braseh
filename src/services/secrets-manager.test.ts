import { describe, expect, it } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import { SystemCommandLive } from "./exec";
import { FileSystem, FileSystemLive } from "./fs";
import { decryptNew, legacyKeyMaterial, SecretStoreLive } from "./secrets";
import { SecretManager, SecretManagerLive } from "./secrets-manager";

function hexMasterKey(): string {
  return randomBytes(32).toString("hex");
}

function encryptWithLegacy(value: string, hex: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", legacyKeyMaterial(hex), iv);
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function encryptWithNew(value: string, hex: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hex, "hex"), iv);
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function runManager<A>(program: Effect.Effect<A, Error, SecretManager>) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(SecretManagerLive),
      Effect.provide(SecretStoreLive),
      Effect.provide(FileSystemLive),
      Effect.provide(SystemCommandLive),
    ),
  );
}

describe("SecretManager Service", () => {
  it("should set and get a secret", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-test-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/secrets.json");
    const masterKeyFile = join(testDir, ".braseh_key");

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);

      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));

      yield* _(sm.set("API_KEY", "my-api-key"));
      const value = yield* _(sm.get("API_KEY"));

      return value;
    });

    const result = await runManager(program);
    expect(result).toBe("my-api-key");

    await rm(testDir, { recursive: true, force: true });
  });

  it("should chmod the master key and secrets file to 0o600 after set", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-mode-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/secrets.json");
    const masterKeyFile = join(testDir, ".braseh_key");

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      yield* _(sm.set("API_KEY", "my-api-key"));
    });

    await runManager(program);

    const secretsStat = await stat(secretsFile);
    const keyStat = await stat(masterKeyFile);
    expect(secretsStat.mode & 0o777).toBe(0o600);
    expect(keyStat.mode & 0o777).toBe(0o600);

    await rm(testDir, { recursive: true, force: true });
  });

  it("should decrypt a legacy blob, rewrite it, and decrypt the rewrite with the new key only", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-migrate-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/secrets.json");
    const masterKeyFile = join(testDir, ".braseh_key");
    const hexKey = hexMasterKey();
    const original = "legacy-secret-value";
    const legacyBlob = encryptWithLegacy(original, hexKey);

    expect(() => decryptNew(legacyBlob, hexKey)).toThrow();

    await mkdir(join(testDir, ".braseh"), { recursive: true });
    await writeFile(masterKeyFile, hexKey);
    await writeFile(
      secretsFile,
      JSON.stringify({ LEGACY: legacyBlob }, null, 2),
    );

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      const first = yield* _(sm.get("LEGACY"));
      const second = yield* _(sm.get("LEGACY"));
      return { first, second };
    });

    const result = await runManager(program);
    expect(result.first).toBe(original);
    expect(result.second).toBe(original);

    const onDisk = await readFile(secretsFile, "utf8");
    expect(onDisk.startsWith("$BRASEH_VAULT;1.0;AES-256-GCM")).toBe(true);
    expect(onDisk).not.toContain(original);
    expect(onDisk).not.toContain("LEGACY");

    const verifyProgram = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      return yield* _(sm.get("LEGACY"));
    });
    expect(await runManager(verifyProgram)).toBe(original);

    await rm(testDir, { recursive: true, force: true });
  });

  it("does not let a corrupt secret block listing or getting another", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-corrupt-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/secrets.json");
    const masterKeyFile = join(testDir, ".braseh_key");
    const hexKey = hexMasterKey();
    const goodBlob = encryptWithNew("good-value", hexKey);
    const corruptBlob = "not-a-valid-secret-blob";

    await mkdir(join(testDir, ".braseh"), { recursive: true });
    await writeFile(masterKeyFile, hexKey);
    await writeFile(
      secretsFile,
      JSON.stringify({ GOOD: goodBlob, BAD: corruptBlob }, null, 2),
    );

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));

      const names = yield* _(sm.list());
      const good = yield* _(sm.get("GOOD"));
      yield* _(sm.set("NEW", "new-value"));
      const namesAfterSet = yield* _(sm.list());
      const created = yield* _(sm.get("NEW"));

      return { names, good, namesAfterSet, created };
    });

    const result = await runManager(program);
    expect(result.names.sort()).toEqual(["BAD", "GOOD"]);
    expect(result.good).toBe("good-value");
    expect(result.created).toBe("new-value");
    expect(result.namesAfterSet.sort()).toEqual(["BAD", "GOOD", "NEW"]);

    const getBad = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      return yield* _(sm.get("BAD"));
    });
    await expect(runManager(getBad)).rejects.toThrow(/Decryption failed/);

    const onDisk = JSON.parse(await readFile(secretsFile, "utf8")) as Record<
      string,
      string
    >;
    expect(onDisk.BAD).toBe(corruptBlob);

    await rm(testDir, { recursive: true, force: true });
  });

  it("writes master key and secrets file as 0o600 immediately after writeFile", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-write-mode-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/secrets.json");
    const masterKeyFile = join(testDir, ".braseh_key");
    const modesAtWrite: number[] = [];

    const TrackingFS = Layer.succeed(
      FileSystem,
      FileSystem.of({
        writeFile: (path, content, options) =>
          Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, content, {
                encoding: "utf-8",
                mode: options?.mode,
              });
              const s = await stat(path);
              modesAtWrite.push(s.mode & 0o777);
            },
            catch: (error) => new Error(String(error)),
          }),
        readFile: (path) =>
          Effect.tryPromise({
            try: () => readFile(path, "utf-8"),
            catch: (error) => new Error(String(error)),
          }),
        exists: (path) =>
          Effect.tryPromise({
            try: async () => {
              try {
                await access(path);
                return true;
              } catch {
                return false;
              }
            },
            catch: (error) => new Error(String(error)),
          }),
        mkdir: (path) =>
          Effect.tryPromise({
            try: async () => {
              await mkdir(path, { recursive: true });
            },
            catch: (error) => new Error(String(error)),
          }),
        symlink: () => Effect.void,
        rm: () => Effect.void,
        rmdir: () => Effect.void,
        unlink: () => Effect.void,
        chmod: () => Effect.void,
        chown: () => Effect.void,
        writeFileBytes: () => Effect.void,
      }),
    );

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      yield* _(sm.set("API_KEY", "my-api-key"));
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(SecretManagerLive),
        Effect.provide(SecretStoreLive),
        Effect.provide(TrackingFS),
      ),
    );

    expect(modesAtWrite.length).toBeGreaterThan(0);
    for (const mode of modesAtWrite) {
      expect(mode).toBe(0o600);
    }

    const secretsStat = await stat(secretsFile);
    const keyStat = await stat(masterKeyFile);
    expect(secretsStat.mode & 0o777).toBe(0o600);
    expect(keyStat.mode & 0o777).toBe(0o600);

    await rm(testDir, { recursive: true, force: true });
  });

  it("stores secrets in whole-file encrypted vault and reveals no key names or values on disk", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-vault-opaque-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/vault");
    const masterKeyFile = join(testDir, ".braseh_key");

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      yield* _(sm.set("MY_SUPER_SECRET_TOKEN", "super-secret-value-12345"));
      yield* _(sm.set("DATABASE_PASSWORD", "db-password-67890"));

      const names = yield* _(sm.list());
      const token = yield* _(sm.get("MY_SUPER_SECRET_TOKEN"));
      const dbPass = yield* _(sm.get("DATABASE_PASSWORD"));
      return { names, token, dbPass };
    });

    const result = await runManager(program);
    expect(result.names.sort()).toEqual([
      "DATABASE_PASSWORD",
      "MY_SUPER_SECRET_TOKEN",
    ]);
    expect(result.token).toBe("super-secret-value-12345");
    expect(result.dbPass).toBe("db-password-67890");

    const fileContent = await readFile(secretsFile, "utf8");
    expect(fileContent.startsWith("$BRASEH_VAULT;1.0;AES-256-GCM")).toBe(true);
    expect(fileContent).not.toContain("MY_SUPER_SECRET_TOKEN");
    expect(fileContent).not.toContain("DATABASE_PASSWORD");
    expect(fileContent).not.toContain("super-secret-value-12345");
    expect(fileContent).not.toContain("db-password-67890");
    expect(fileContent).not.toContain("{");
    expect(fileContent).not.toContain("}");

    await rm(testDir, { recursive: true, force: true });
  });

  it("resolves sibling vault files in preference order (vault, secrets.vault, secrets.json)", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-resolve-" + Math.random().toString(36).slice(2),
    );
    const brasehDir = join(testDir, ".braseh");
    await mkdir(brasehDir, { recursive: true });
    const masterKeyFile = join(testDir, ".braseh_key");

    const legacyPath = join(brasehDir, "secrets.json");
    const program1 = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile: legacyPath, masterKeyFile }));
      yield* _(sm.set("FALLBACK_SECRET", "found-in-json"));
    });
    await runManager(program1);

    const program2 = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(
        sm.setPaths({ secretsFile: join(brasehDir, "vault"), masterKeyFile }),
      );
      return yield* _(sm.get("FALLBACK_SECRET"));
    });
    const found = await runManager(program2);
    expect(found).toBe("found-in-json");

    await rm(testDir, { recursive: true, force: true });
  });

  it("removes secrets and saves the updated whole-file vault", async () => {
    const testDir = join(
      tmpdir(),
      "braseh-sm-remove-" + Math.random().toString(36).slice(2),
    );
    const secretsFile = join(testDir, ".braseh/vault");
    const masterKeyFile = join(testDir, ".braseh_key");

    const program = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      yield* _(sm.set("A", "val-a"));
      yield* _(sm.set("B", "val-b"));
      yield* _(sm.remove("A"));

      const names = yield* _(sm.list());
      const b = yield* _(sm.get("B"));
      return { names, b };
    });

    const result = await runManager(program);
    expect(result.names).toEqual(["B"]);
    expect(result.b).toBe("val-b");

    const getA = Effect.gen(function* (_) {
      const sm = yield* _(SecretManager);
      yield* _(sm.setPaths({ secretsFile, masterKeyFile }));
      return yield* _(sm.get("A"));
    });
    await expect(runManager(getA)).rejects.toThrow(/Secret not found: A/);

    await rm(testDir, { recursive: true, force: true });
  });

  it("does not treat Object.prototype names as secrets, and rejects __proto__", async () => {
    const testDir = join(tmpdir(), "braseh-sm-proto-" + Math.random().toString(36).slice(2));
    const paths = { secretsFile: join(testDir, ".braseh", "vault"), masterKeyFile: join(testDir, ".braseh_key") };
    const attempt = <A>(f: (sm: SecretManager) => Effect.Effect<A, Error>) =>
      runManager(Effect.either(Effect.gen(function* () {
        const sm = yield* SecretManager;
        yield* sm.setPaths(paths);
        return yield* f(sm);
      })));

    await attempt((sm) => sm.set("REAL", "value"));
    const toStringResult = await attempt((sm) => sm.get("toString"));
    expect(toStringResult._tag === "Left" ? toStringResult.left.message : "").toContain("Secret not found: toString");
    const protoResult = await attempt((sm) => sm.set("__proto__", "x"));
    expect(protoResult._tag).toBe("Left");
    const listed = await attempt((sm) => sm.list());
    expect(listed._tag === "Right" ? listed.right : []).toEqual(["REAL"]);

    await rm(testDir, { recursive: true, force: true });
  });

  it("does not look for a vault in parent directories", async () => {
    const root = join(tmpdir(), "braseh-sm-parent-" + Math.random().toString(36).slice(2));
    const masterKeyFile = join(root, ".braseh_key");
    const inParent = Effect.gen(function* () {
      const sm = yield* SecretManager;
      yield* sm.setPaths({ secretsFile: join(root, ".braseh", "vault"), masterKeyFile });
      yield* sm.set("PARENT_ONLY", "planted");
    });
    await runManager(inParent);

    const fromChild = await runManager(Effect.either(Effect.gen(function* () {
      const sm = yield* SecretManager;
      yield* sm.setPaths({ secretsFile: join(root, "child", ".braseh", "vault"), masterKeyFile });
      return yield* sm.get("PARENT_ONLY");
    })));
    expect(fromChild._tag).toBe("Left");

    await rm(root, { recursive: true, force: true });
  });
});
