import { sha256Hex } from "../protocol/sha256.js";

export function maskSecret(value: string): string {
  if (value.length <= 5) {
    return "••••";
  }
  return `••••${value.slice(-5)}`;
}

export function fingerprintSecret(value: string): string {
  return sha256Hex(value).slice(0, 16);
}

export function keyDisplayId(value: string): string {
  if (value.length <= 5) {
    return value;
  }
  return value.slice(-5);
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "";
    }
    return url.toString();
  } catch {
    return "<invalid>";
  }
}

export class SecretRedactor {
  private values: string[] = [];

  replace(values: string[]): void {
    this.values = [...values].sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    let result = text;
    for (const secret of this.values) {
      if (secret.length >= 4) {
        result = result.split(secret).join("***");
      }
    }
    return result;
  }
}
