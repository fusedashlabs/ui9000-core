import { DATA_PROFILE_KEYS, type DataProfile, type DataProfileKey } from '../spec/data-profile.js';

const PROFILE_KEY_SET = new Set<string>(DATA_PROFILE_KEYS);

type CmpOp = '===' | '!==' | '<=' | '>=' | '<' | '>';

type Token =
  | { kind: 'profile'; key: DataProfileKey }
  | { kind: 'number'; value: number }
  | { kind: 'op'; op: '&&' | '||' | '!' | CmpOp }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

const CMP_OPS: CmpOp[] = ['===', '!==', '<=', '>=', '<', '>'];

function isDataProfileKey(key: string): key is DataProfileKey {
  return PROFILE_KEY_SET.has(key);
}

function tokenize(when: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = when;

  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  };

  while (i < src.length) {
    skipWs();
    if (i >= src.length) break;

    if (src.startsWith('profile.', i)) {
      i += 'profile.'.length;
      const start = i;
      if (!/[A-Za-z]/.test(src[i] ?? '')) {
        throw new Error(`when: expected DataProfile key after profile. at ${start}`);
      }
      i += 1;
      while (i < src.length && /[A-Za-z0-9]/.test(src[i])) i += 1;
      const key = src.slice(start, i);
      if (!isDataProfileKey(key)) {
        throw new Error(`when references unknown DataProfile key "${key}"`);
      }
      skipWs();
      if (src[i] === '(') {
        throw new Error('when does not allow calls');
      }
      tokens.push({ kind: 'profile', key });
      continue;
    }

    if (src.startsWith('&&', i)) {
      tokens.push({ kind: 'op', op: '&&' });
      i += 2;
      continue;
    }
    if (src.startsWith('||', i)) {
      tokens.push({ kind: 'op', op: '||' });
      i += 2;
      continue;
    }
    if (src.startsWith('===', i)) {
      tokens.push({ kind: 'op', op: '===' });
      i += 3;
      continue;
    }
    if (src.startsWith('!==', i)) {
      tokens.push({ kind: 'op', op: '!==' });
      i += 3;
      continue;
    }
    if (src.startsWith('<=', i)) {
      tokens.push({ kind: 'op', op: '<=' });
      i += 2;
      continue;
    }
    if (src.startsWith('>=', i)) {
      tokens.push({ kind: 'op', op: '>=' });
      i += 2;
      continue;
    }
    if (src[i] === '<' || src[i] === '>') {
      tokens.push({ kind: 'op', op: src[i] as '<' | '>' });
      i += 1;
      continue;
    }
    if (src[i] === '!') {
      tokens.push({ kind: 'op', op: '!' });
      i += 1;
      continue;
    }
    if (src[i] === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (src[i] === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }

    if (src[i] === '-' || /[0-9]/.test(src[i])) {
      const start = i;
      if (src[i] === '-') i += 1;
      if (!/[0-9]/.test(src[i] ?? '')) {
        throw new Error(`when uses disallowed characters near "${src.slice(start)}"`);
      }
      while (i < src.length && /[0-9]/.test(src[i])) i += 1;
      if (src[i] === '.') {
        i += 1;
        if (!/[0-9]/.test(src[i] ?? '')) {
          throw new Error('when: number has a trailing dot');
        }
        while (i < src.length && /[0-9]/.test(src[i])) i += 1;
      }
      tokens.push({ kind: 'number', value: Number(src.slice(start, i)) });
      continue;
    }

    throw new Error(`when uses disallowed characters: ${src.slice(i)}`);
  }

  return tokens;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly profile: DataProfile,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private peekOp(op: '&&' | '||' | '!' | CmpOp): boolean {
    const token = this.peek();
    return token?.kind === 'op' && token.op === op;
  }

  private take(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new Error('when: unexpected end of expression');
    this.pos += 1;
    return token;
  }

  expectEnd(): void {
    if (this.pos !== this.tokens.length) {
      throw new Error('when: unexpected trailing tokens');
    }
  }

  parseExpr(): unknown {
    return this.parseOr();
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peekOp('||')) {
      this.take();
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseComparison();
    while (this.peekOp('&&')) {
      this.take();
      const right = this.parseComparison();
      left = left && right;
    }
    return left;
  }

  private parseComparison(): unknown {
    const left = this.parseUnary();
    const next = this.peek();
    if (next?.kind === 'op' && (CMP_OPS as string[]).includes(next.op)) {
      const op = next.op as CmpOp;
      this.take();
      const right = this.parseUnary();
      return compare(op, left, right);
    }
    return left;
  }

  private parseUnary(): unknown {
    const next = this.peek();
    if (next?.kind === 'op' && next.op === '!') {
      this.take();
      return !this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const token = this.take();
    if (token.kind === 'profile') {
      return this.profile[token.key];
    }
    if (token.kind === 'number') {
      return token.value;
    }
    if (token.kind === 'lparen') {
      const inner = this.parseExpr();
      const close = this.take();
      if (close.kind !== 'rparen') {
        throw new Error('when: expected closing parenthesis');
      }
      return inner;
    }
    throw new Error('when: expected profile key, number, or grouped expression');
  }
}

function compare(op: CmpOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '<=':
      return (left as number) <= (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '<':
      return (left as number) < (right as number);
    case '>':
      return (left as number) > (right as number);
  }
}

/** Pull `profile.<key>` identifiers out of a `when` string. */
export function profileKeysInWhen(when: string): string[] {
  return tokenize(when)
    .filter((token): token is Extract<Token, { kind: 'profile' }> => token.kind === 'profile')
    .map((token) => token.key);
}

export function assertWhenUsesClosedProfile(when: string): void {
  if (!when.trim()) {
    throw new Error('empty when expression');
  }
  tokenize(when);
}

export function assertProfileUsesClosedKeys(profile: DataProfile): void {
  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEY_SET.has(key)) {
      throw new Error(`evalCases.profile has unknown key "${key}"`);
    }
  }
}

/**
 * Evaluate a catalog `when` string against a profile.
 * Only `profile.<DataProfileKey>`, numbers, && || ! comparisons, and grouping.
 */
export function evalWhen(when: string, profile: DataProfile): boolean {
  assertWhenUsesClosedProfile(when);
  const parser = new Parser(tokenize(when), profile);
  const value = parser.parseExpr();
  parser.expectEnd();
  return Boolean(value);
}

export { isDataProfileKey };
