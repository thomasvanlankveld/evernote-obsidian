export interface MainStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface MainOptions {
  /** Override cwd for path resolution and defaults (tests). */
  cwd?: string | undefined;
}
