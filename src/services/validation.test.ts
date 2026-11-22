import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ValidationService, ValidationServiceLive } from "./validation";
import { FileSystem } from "./fs";
import { SecretManager, SecretManagerLive } from "./secrets-manager";
import { App, Stack } from "../core/app";
import { FileResource } from "../resources/file";
import { secret } from "../core/secret";

describe("ValidationService", () => {
  const MockFS = Layer.succeed(
    FileSystem,
    FileSystem.of({ writeFileBytes: () => Effect.void } as any),
  );

  const getMockSM = (secrets: string[]) =>
    Layer.succeed(
      SecretManager,
      SecretManager.of({
        list: () => Effect.succeed(secrets),
        get: () => Effect.succeed(""),
        set: () => Effect.void,
        setPaths: () => Effect.void,
        remove: () => Effect.void,
      }),
    );

  it("should validate a correct component tree", async () => {
    const app = new App();
    const stack = new Stack(app, "test");
    new FileResource(stack, "file-1", { path: "/tmp/ok", content: "hello" });

    const program = Effect.gen(function* () {
      const validator = yield* ValidationService;
      yield* validator.validate(app);
    });

    const MainLive = ValidationServiceLive.pipe(
      Layer.provideMerge(getMockSM([])),
      Layer.provideMerge(MockFS),
    );

    await Effect.runPromise(Effect.provide(program, MainLive));
  });

  it("should fail if a referenced secret is missing", async () => {
    const app = new App();
    const stack = new Stack(app, "test");
    new FileResource(stack, "file-1", {
      path: "/tmp/ok",
      content: secret("MISSING_KEY"),
    });

    const program = Effect.gen(function* () {
      const validator = yield* ValidationService;
      yield* validator.validate(app);
    });

    const MainLive = ValidationServiceLive.pipe(
      Layer.provideMerge(getMockSM([])),
      Layer.provideMerge(MockFS),
    );

    expect(
      Effect.runPromise(Effect.provide(program, MainLive)),
    ).rejects.toThrow(/Secret not found: MISSING_KEY/);
  });

  it("should fail if a script references a missing binary with no dependsOn", async () => {
    const { ScriptResource } = await import("../resources/script");
    const app = new App();
    const stack = new Stack(app, "test");
    new ScriptResource(stack, "script-1", {
      run: "~/.cargo/bin/cargo install foo",
    });

    const mockFSWithMissing = Layer.succeed(
      FileSystem,
      FileSystem.of({
        exists: () => Effect.succeed(false),
      } as any),
    );

    const program = Effect.gen(function* () {
      const validator = yield* ValidationService;
      yield* validator.validate(app);
    });

    const MainLive = ValidationServiceLive.pipe(
      Layer.provideMerge(getMockSM([])),
      Layer.provideMerge(mockFSWithMissing),
    );

    expect(
      Effect.runPromise(Effect.provide(program, MainLive)),
    ).rejects.toThrow(
      /which does not exist on the filesystem and has no declared dependencies/,
    );
  });

  it("should succeed if a script with missing binary has declared dependsOn", async () => {
    const { ScriptResource } = await import("../resources/script");
    const app = new App();
    const stack = new Stack(app, "test");
    const producer = new FileResource(stack, "producer", {
      path: "/tmp/producer",
      content: "test",
    });
    new ScriptResource(stack, "script-1", {
      run: "~/.cargo/bin/cargo install foo",
      dependsOn: [producer],
    });

    const mockFSWithMissing = Layer.succeed(
      FileSystem,
      FileSystem.of({
        exists: () => Effect.succeed(false),
      } as any),
    );

    const program = Effect.gen(function* () {
      const validator = yield* ValidationService;
      yield* validator.validate(app);
    });

    const MainLive = ValidationServiceLive.pipe(
      Layer.provideMerge(getMockSM([])),
      Layer.provideMerge(mockFSWithMissing),
    );

    await Effect.runPromise(Effect.provide(program, MainLive));
  });

  it("should succeed if a script with missing binary has onlyIf", async () => {
    const { ScriptResource } = await import("../resources/script");
    const app = new App();
    const stack = new Stack(app, "test");
    new ScriptResource(stack, "script-1", {
      run: "~/.cargo/bin/cargo install foo",
      onlyIf: "test -f ~/.cargo/bin/cargo",
    });

    const mockFSWithMissing = Layer.succeed(
      FileSystem,
      FileSystem.of({
        exists: () => Effect.succeed(false),
      } as any),
    );

    const program = Effect.gen(function* () {
      const validator = yield* ValidationService;
      yield* validator.validate(app);
    });

    const MainLive = ValidationServiceLive.pipe(
      Layer.provideMerge(getMockSM([])),
      Layer.provideMerge(mockFSWithMissing),
    );

    await Effect.runPromise(Effect.provide(program, MainLive));
  });

  const validate = (app: App, secrets: string[] = []) =>
    Effect.runPromise(Effect.either(Effect.gen(function* () {
      const validator = yield* ValidationService;
      yield* validator.validate(app);
    }).pipe(Effect.provide(ValidationServiceLive.pipe(Layer.provideMerge(getMockSM(secrets)), Layer.provideMerge(MockFS))))));

  it("fails when one id is declared twice with different settings", async () => {
    const app = new App();
    const stack = new Stack(app, "test");
    new FileResource(stack, "file:/tmp/x", { path: "/tmp/x", content: "one" });
    new FileResource(stack, "file:/tmp/x", { path: "/tmp/x", content: "two" });
    const result = await validate(app);
    expect(result._tag).toBe("Left");
    expect(String(result._tag === "Left" ? result.left.message : "")).toContain("declared more than once");
  });

  it("allows a duplicate id ordered by dependsOn, like create then state: absent", async () => {
    const app = new App();
    const stack = new Stack(app, "test");
    const first = new FileResource(stack, "file:/tmp/x", { path: "/tmp/x", content: "one" });
    new FileResource(stack, "file:/tmp/x", { path: "/tmp/x", content: "two", dependsOn: [first] });
    expect((await validate(app))._tag).toBe("Right");
  });

  it("allows identical duplicate declarations", async () => {
    const app = new App();
    const stack = new Stack(app, "test");
    new FileResource(stack, "file:/tmp/x", { path: "/tmp/x", content: "same" });
    new FileResource(stack, "file:/tmp/x", { path: "/tmp/x", content: "same" });
    expect((await validate(app))._tag).toBe("Right");
  });

  it("checks secrets referenced inside nested file vars", async () => {
    const app = new App();
    const stack = new Stack(app, "test");
    new FileResource(stack, "file:/tmp/npmrc", {
      path: "/tmp/npmrc",
      content: "{{auth.token}}",
      vars: { auth: { token: secret("NPM_TOKEN") } },
    });
    const missing = await validate(app);
    expect(String(missing._tag === "Left" ? missing.left.message : "")).toContain("Secret not found: NPM_TOKEN");
    expect((await validate(app, ["NPM_TOKEN"]))._tag).toBe("Right");
  });
});
