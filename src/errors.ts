export class SniperError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "config_error"
      | "onboarding_error"
      | "fetch_error"
      | "parse_error"
      | "sync_error"
      | "not_found"
      | "validation_error"
      | "runtime_error",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SniperError";
  }
}

export function toSniperError(
  error: unknown,
  fallbackCode: SniperError["code"] = "runtime_error",
  details?: Record<string, unknown>,
): SniperError {
  if (error instanceof SniperError) {
    return error;
  }
  if (error instanceof Error) {
    return new SniperError(error.message, fallbackCode, details);
  }
  return new SniperError(String(error), fallbackCode, details);
}
