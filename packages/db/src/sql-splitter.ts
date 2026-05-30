export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inDollarBlock = false;
  let dollarTag = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = "";
  };

  const tryConsumeDollarTag = (source: string, startIndex: number) => {
    let tag = "$";
    let index = startIndex + 1;
    while (index < source.length && /[a-zA-Z0-9_]/.test(source[index])) {
      tag += source[index];
      index++;
    }
    if (index < source.length && source[index] === "$") {
      tag += "$";
      return { tag, endIndex: index + 1 };
    }
    return null;
  };

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inDollarBlock) {
      if (char === "-" && next === "-") {
        inLineComment = true;
        index++;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        index++;
        continue;
      }
    }

    if (!inSingleQuote && !inDoubleQuote && char === "$") {
      const consumed = tryConsumeDollarTag(sql, index);
      if (consumed) {
        if (!inDollarBlock) {
          inDollarBlock = true;
          dollarTag = consumed.tag;
          current += consumed.tag;
          index = consumed.endIndex - 1;
          continue;
        }
        if (consumed.tag === dollarTag) {
          inDollarBlock = false;
          current += consumed.tag;
          dollarTag = "";
          index = consumed.endIndex - 1;
          continue;
        }
      }
    }

    if (inDollarBlock) {
      current += char;
      continue;
    }

    if (!inDoubleQuote && char === "'") {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        index++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && char === "\"") {
      inDoubleQuote = !inDoubleQuote;
    }

    current += char;
    if (!inSingleQuote && !inDoubleQuote && char === ";") {
      pushCurrent();
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
