import type { ArgsDef, CommandContext, CommandDef, CommandMeta } from "citty";

// ---------------------------------------------------------------------------
// citty types `meta` and `args` as `Resolvable<T>` — `T | Promise<T> | (() => T)
// | (() => Promise<T>)`. Every command in this repo defines them as plain object
// literals, so `cmd.meta.name` works at runtime; TypeScript just cannot know
// that from the declared type. 37 of the test-suite's type errors were this one
// fact restated in six files.
//
// These narrow with a RUNTIME CHECK rather than a cast. That is the point: the
// "our commands always use a plain object" assumption is exactly what would
// break if someone shipped a lazy/async meta, and a cast would hide that until
// something downstream read `undefined`. Here it fails loudly, in the test that
// depends on it, naming the command.
// ---------------------------------------------------------------------------

function assertPlain<T>(value: unknown, what: string): T {
  if (typeof value === "function") {
    throw new TypeError(
      `${what} is a lazy Resolvable (function). Tests read it synchronously — ` +
        `either keep it a plain object literal, or await citty's resolver here.`,
    );
  }
  if (value instanceof Promise) {
    throw new TypeError(`${what} is a Promise. Tests read it synchronously — await it first.`);
  }
  return value as T;
}

// Generic over the command's own ArgsDef so `argsOf` keeps the literal flag
// keys — tests index them by name (`args["mcp-root-mode"]`), which a widened
// `ArgsDef` return would turn back into an implicit-any error.

/** `cmd.meta` narrowed to a plain CommandMeta. Empty object when meta is absent. */
export function metaOf<T extends ArgsDef>(cmd: CommandDef<T>, label = "command.meta"): CommandMeta {
  return assertPlain<CommandMeta | undefined>(cmd.meta, label) ?? {};
}

/** `cmd.meta.name`, or undefined when the command declares no meta/name. */
export function nameOf<T extends ArgsDef>(cmd: CommandDef<T>, label = "command.meta"): string | undefined {
  return metaOf(cmd, label).name;
}

/** `cmd.args` narrowed to the command's own plain ArgsDef. */
export function argsOf<T extends ArgsDef>(cmd: CommandDef<T>, label = "command.args"): T {
  return assertPlain<T | undefined>(cmd.args, label) ?? ({} as T);
}

/** A subcommand with its arg shape erased — enough to read meta/args/run in tests. */
export type AnyCommand = CommandDef<ArgsDef>;

/**
 * `cmd.subCommands` narrowed — TWO levels, because citty types the map itself
 * as Resolvable AND every entry inside it as Resolvable.
 */
export function subCommandsOf<T extends ArgsDef>(
  cmd: CommandDef<T>,
  label = "command.subCommands",
): Record<string, AnyCommand> {
  const map = assertPlain<Record<string, unknown> | undefined>(cmd.subCommands, label) ?? {};
  const out: Record<string, AnyCommand> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = assertPlain<AnyCommand>(value, `${label}.${key}`);
  }
  return out;
}

/**
 * Build the context for calling `cmd.run(...)` directly from a test.
 *
 * citty's `ParsedArgs<T>` is the shape AFTER parsing: every declared flag is
 * present, defaults applied. A test that exercises one code path supplies only
 * the flags that path reads — writing out all ~10 flags at each call site would
 * be pure drift bait (add a flag, break every test that never used it).
 *
 * So this is the ONE place in the test suite that asserts the partial args are
 * good enough, and it is deliberately concentrated here rather than sprinkled
 * as `as never` at each call site (which is where it lived before, unexplained).
 * The trade-off is real and narrow: a typo'd flag name in `args` is not caught
 * by the compiler. It IS caught by the assertion that follows — a command that
 * never sees its flag does not produce the expected output.
 */
export function runCtx<T extends ArgsDef>(
  cmd: CommandDef<T>,
  args: Record<string, unknown> = {},
): CommandContext<T> {
  return { args, rawArgs: [], cmd, data: undefined } as unknown as CommandContext<T>;
}

/** One subcommand by name, or undefined when it is not registered. */
export function subCommandOf<T extends ArgsDef>(
  cmd: CommandDef<T>,
  name: string,
  label = "command.subCommands",
): AnyCommand | undefined {
  return subCommandsOf(cmd, label)[name];
}
