import * as React from "react";

export type Language = "lua" | "json" | "bash" | "text";

type Kind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "literal"
  | "global"
  | "func"
  | "property"
  | "punct"
  | "flag";

interface Token {
  text: string;
  kind: Kind;
}

/** Tailwind classes, chosen to stay legible on the muted code-block background. */
const COLORS: Record<Exclude<Kind, "plain">, string> = {
  comment: "text-muted-foreground italic",
  string: "text-emerald-400",
  number: "text-amber-300",
  keyword: "text-violet-400",
  literal: "text-orange-400",
  global: "text-sky-400",
  func: "text-blue-400",
  property: "text-cyan-300",
  punct: "text-muted-foreground",
  flag: "text-amber-300",
};

const LUA_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
  "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
  "continue", "export", "type", "typeof",
]);

const LUA_GLOBALS = new Set([
  "game", "workspace", "shared", "script", "_G", "_ENV", "getgenv", "getrenv", "getreg",
  "getgc", "getinstances", "getnilinstances", "getscripts", "getloadedmodules", "getmodules",
  "getrunningscripts", "getscripthash", "getscriptclosure", "getscriptbytecode", "decompile",
  "getconnections", "firesignal", "getrawmetatable", "setrawmetatable", "hookfunction",
  "hookmetamethod", "newcclosure", "checkcaller", "getnamecallmethod", "setreadonly",
  "isreadonly", "getgenv", "identifyexecutor", "request", "http_request", "syn", "http",
  "task", "wait", "spawn", "delay", "tick", "print", "warn", "error", "pcall", "xpcall",
  "select", "pairs", "ipairs", "next", "type", "tostring", "tonumber", "loadstring",
  "require", "setmetatable", "getmetatable", "rawget", "rawset", "rawequal", "assert",
  "unpack", "table", "string", "math", "os", "coroutine", "debug", "bit32", "utf8", "buffer",
  "Instance", "Vector3", "Vector2", "CFrame", "Color3", "BrickColor", "UDim", "UDim2",
  "Ray", "Region3", "Rect", "NumberRange", "NumberSequence", "ColorSequence", "Enum",
  "TweenInfo", "Random", "DateTime", "OverlapParams", "RaycastParams",
]);

const LUA_OPERATOR = /^(\.\.\.|\.\.|==|~=|<=|>=|::|\/\/|<<|>>|[+\-*/%^#=<>(){}\[\];:,.])/;
const LUA_NUMBER = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/;

function lexLua(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  const push = (text: string, kind: Kind) => {
    if (text) out.push({ text, kind });
  };
  /** Last token that was not pure whitespace, used to spot `foo.bar` / `foo:bar`. */
  const lastSignificant = (): string | null => {
    for (let k = out.length - 1; k >= 0; k -= 1) {
      const token = out[k]!;
      if (token.text.trim() !== "") return token.text;
    }
    return null;
  };

  while (i < source.length) {
    const char = source[i]!;
    const rest = source.slice(i);

    if (char === "-" && source[i + 1] === "-") {
      const long = /^--\[(=*)\[/.exec(rest);
      if (long) {
        const close = `]${long[1]}]`;
        const end = source.indexOf(close, i + long[0].length);
        const stop = end === -1 ? source.length : end + close.length;
        push(source.slice(i, stop), "comment");
        i = stop;
      } else {
        const end = source.indexOf("\n", i);
        const stop = end === -1 ? source.length : end;
        push(source.slice(i, stop), "comment");
        i = stop;
      }
      continue;
    }

    if (char === "[") {
      const long = /^\[(=*)\[/.exec(rest);
      if (long) {
        const close = `]${long[1]}]`;
        const end = source.indexOf(close, i + long[0].length);
        const stop = end === -1 ? source.length : end + close.length;
        push(source.slice(i, stop), "string");
        i = stop;
        continue;
      }
    }

    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === char) {
          j += 1;
          break;
        }
        if (source[j] === "\n") break;
        j += 1;
      }
      push(source.slice(i, j), "string");
      i = j;
      continue;
    }

    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      push(whitespace[0], "plain");
      i += whitespace[0].length;
      continue;
    }

    const number = LUA_NUMBER.exec(rest);
    if (number && /[0-9]/.test(char)) {
      push(number[0], "number");
      i += number[0].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) {
      const text = word[0];
      const previous = lastSignificant();
      const after = source.slice(i + text.length);
      let kind: Kind;
      if (previous === "." || previous === ":") kind = "property";
      else if (LUA_KEYWORDS.has(text)) kind = "keyword";
      else if (LUA_GLOBALS.has(text)) kind = "global";
      else if (/^\s*[({]/.test(after)) kind = "func";
      else kind = "plain";
      push(text, kind);
      i += text.length;
      continue;
    }

    const operator = LUA_OPERATOR.exec(rest);
    if (operator) {
      push(operator[0], "punct");
      i += operator[0].length;
      continue;
    }

    push(char, "plain");
    i += 1;
  }

  return out;
}

function lexJson(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i]!;
    const rest = source.slice(i);

    if (char === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      const text = source.slice(i, j);
      const isKey = /^\s*:/.test(source.slice(j));
      out.push({ text, kind: isKey ? "property" : "string" });
      i = j;
      continue;
    }

    const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (number && /[-0-9]/.test(char)) {
      out.push({ text: number[0], kind: "number" });
      i += number[0].length;
      continue;
    }

    const literal = /^(true|false|null)\b/.exec(rest);
    if (literal) {
      out.push({ text: literal[0], kind: "literal" });
      i += literal[0].length;
      continue;
    }

    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      out.push({ text: whitespace[0], kind: "plain" });
      i += whitespace[0].length;
      continue;
    }

    if (/[{}[\],:]/.test(char)) {
      out.push({ text: char, kind: "punct" });
      i += 1;
      continue;
    }

    out.push({ text: char, kind: "plain" });
    i += 1;
  }

  return out;
}

function lexBash(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let expectingCommand = true;

  while (i < source.length) {
    const char = source[i]!;
    const rest = source.slice(i);

    if (char === "#" && (i === 0 || /\s/.test(source[i - 1]!))) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out.push({ text: source.slice(i, stop), kind: "comment" });
      i = stop;
      continue;
    }

    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (char === '"' && source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === char) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push({ text: source.slice(i, j), kind: "string" });
      i = j;
      expectingCommand = false;
      continue;
    }

    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      out.push({ text: whitespace[0], kind: "plain" });
      if (whitespace[0].includes("\n")) expectingCommand = true;
      i += whitespace[0].length;
      continue;
    }

    const url = /^\S+:\/\/\S+/.exec(rest);
    if (url) {
      out.push({ text: url[0], kind: "string" });
      i += url[0].length;
      expectingCommand = false;
      continue;
    }

    const flag = /^--?[A-Za-z][A-Za-z0-9-]*/.exec(rest);
    if (flag) {
      out.push({ text: flag[0], kind: "flag" });
      i += flag[0].length;
      expectingCommand = false;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_.+-]*/.exec(rest);
    if (word) {
      out.push({ text: word[0], kind: expectingCommand ? "func" : "plain" });
      i += word[0].length;
      expectingCommand = false;
      continue;
    }

    if (/[|&;<>\\]/.test(char)) {
      out.push({ text: char, kind: "punct" });
      i += 1;
      continue;
    }

    out.push({ text: char, kind: "plain" });
    i += 1;
  }

  return out;
}

export function highlight(code: string, language: Language): Token[] {
  switch (language) {
    case "lua":
      return lexLua(code);
    case "json":
      return lexJson(code);
    case "bash":
      return lexBash(code);
    default:
      return [{ text: code, kind: "plain" }];
  }
}

export function Highlighted({ code, language }: { code: string; language: Language }) {
  const tokens = React.useMemo(() => highlight(code, language), [code, language]);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          <React.Fragment key={index}>{token.text}</React.Fragment>
        ) : (
          <span key={index} className={COLORS[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}
