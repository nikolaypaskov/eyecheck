import { readFile } from "node:fs/promises";

export interface TokenMap {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  fontSize: Record<string, string>;
}

export function emptyTokenMap(): TokenMap {
  return { colors: {}, spacing: {}, fontSize: {} };
}

export async function extractCssCustomProperties(cssPath: string): Promise<TokenMap> {
  const content = await readFile(cssPath, "utf-8");
  const tokens = emptyTokenMap();

  // Match CSS custom properties: --name: value;
  const propRegex = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = propRegex.exec(content)) !== null) {
    const name = match[1];
    const value = match[2].trim();

    if (isColorValue(value)) {
      tokens.colors[name] = value;
    } else if (isSpacingValue(value)) {
      tokens.spacing[name] = value;
    } else if (isFontSizeValue(name)) {
      tokens.fontSize[name] = value;
    }
  }

  return tokens;
}

export async function extractTailwindTokens(configPath: string): Promise<TokenMap> {
  const content = await readFile(configPath, "utf-8");
  const tokens = emptyTokenMap();

  // Extract colors from theme.extend.colors or theme.colors
  const colorMatches = content.matchAll(/['"]([a-zA-Z0-9-]+)['"]\s*:\s*['"]([#\w(),.\/\s]+)['"]/g);
  for (const m of colorMatches) {
    const name = m[1];
    const value = m[2];
    if (isColorValue(value)) {
      tokens.colors[name] = value;
    }
  }

  // Extract spacing values
  const spacingSection = extractSection(content, "spacing");
  if (spacingSection) {
    const spacingMatches = spacingSection.matchAll(/['"]?(\w+)['"]?\s*:\s*['"]([\d.]+(?:px|rem|em)?)['"]/g);
    for (const m of spacingMatches) {
      tokens.spacing[m[1]] = m[2];
    }
  }

  // Extract fontSize values
  const fontSection = extractSection(content, "fontSize");
  if (fontSection) {
    const fontMatches = fontSection.matchAll(/['"]?(\w+)['"]?\s*:\s*['"]([\d.]+(?:px|rem|em)?)['"]/g);
    for (const m of fontMatches) {
      tokens.fontSize[m[1]] = m[2];
    }
  }

  return tokens;
}

export function mergeTokenMaps(...maps: TokenMap[]): TokenMap {
  const result = emptyTokenMap();
  for (const map of maps) {
    Object.assign(result.colors, map.colors);
    Object.assign(result.spacing, map.spacing);
    Object.assign(result.fontSize, map.fontSize);
  }
  return result;
}

export function mapValueToToken(value: string, tokens: TokenMap): string | null {
  const normalized = value.trim().toLowerCase();

  // Check colors
  for (const [name, tokenValue] of Object.entries(tokens.colors)) {
    if (tokenValue.toLowerCase() === normalized) {
      return `var(--${name})`;
    }
  }

  // Check spacing
  for (const [name, tokenValue] of Object.entries(tokens.spacing)) {
    if (tokenValue.toLowerCase() === normalized) {
      return `spacing-${name}`;
    }
  }

  // Check font sizes
  for (const [name, tokenValue] of Object.entries(tokens.fontSize)) {
    if (tokenValue.toLowerCase() === normalized) {
      return `font-${name}`;
    }
  }

  return null;
}

function isColorValue(value: string): boolean {
  return /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|[a-z]+)$/i.test(value.trim());
}

function isSpacingValue(value: string): boolean {
  return /^\d+(\.\d+)?(px|rem|em|%)$/.test(value.trim());
}

function isFontSizeValue(name: string): boolean {
  return /font-size|text|fs/i.test(name);
}

function extractSection(content: string, key: string): string | null {
  const regex = new RegExp(`${key}\\s*:\\s*\\{([^}]*)\\}`, "s");
  const match = content.match(regex);
  return match ? match[1] : null;
}
