export type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

const LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(level: string, output: "stdout" | "stderr" = "stdout"): Logger {
  const threshold = LEVELS[level] || LEVELS.info;

  function write(
    messageLevel: keyof typeof LEVELS,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (LEVELS[messageLevel] < threshold) return;

    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    const line = `[${new Date().toISOString()}] ${messageLevel.toUpperCase()} ${message}${suffix}`;

    if (output === "stderr") {
      console.error(line);
      return;
    }

    if (messageLevel === "error") {
      console.error(line);
      return;
    }

    if (messageLevel === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

export function createStderrLogger(level: string): Logger {
  return createLogger(level, "stderr");
}
