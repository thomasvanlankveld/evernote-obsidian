export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface MainOptions {
  /** Override cwd for path resolution and defaults (tests). */
  cwd?: string | undefined;
}

export interface SubcommandParseOptions {
  permissive?: boolean | undefined;
  subcommand?: string | undefined;
  /** Pre-resolved vault root (`run`); step parsers skip independent resolution. */
  vaultRoot?: string | undefined;
}
