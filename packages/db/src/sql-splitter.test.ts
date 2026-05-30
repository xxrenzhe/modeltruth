import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./sql-splitter";

describe("splitSqlStatements", () => {
  it("does not split semicolons inside quotes or dollar blocks", () => {
    const statements = splitSqlStatements(`
      create table example (id text, body text default 'a;b');
      do $$ begin raise notice 'x;y'; end $$;
      insert into example values ('1', 'ok');
    `);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("'a;b'");
    expect(statements[1]).toContain("raise notice");
  });
});
