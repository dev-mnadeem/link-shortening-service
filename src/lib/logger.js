const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Minimal structured logger writing one JSON object per line.
 *
 * Deliberately dependency-free and deliberately narrow: it never receives a
 * client IP or user-agent. Those are click-analytics data that belong in
 * `url_clicks` under an explicit retention policy, not scattered through
 * application logs where nobody expires them.
 */
export const createLogger = ({ level = "info", sink = console } = {}) => {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (levelName, message, context) => {
    if (LEVELS[levelName] < threshold) {
      return;
    }

    const line = JSON.stringify({
      level: levelName,
      time: new Date().toISOString(),
      message,
      ...(context ?? {}),
    });

    if (levelName === "error" || levelName === "warn") {
      sink.error(line);
      return;
    }

    sink.log(line);
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
  };
};

export const silentLogger = createLogger({ level: "silent" });
