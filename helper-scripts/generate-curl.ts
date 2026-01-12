import * as sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

const CONFIG = {
  SQL_SERVER: process.env.MSSQL_SERVER ?? "localhost",
  SQL_DB: process.env.MSSQL_DATABASE ?? "triviacreep",
  SQL_USER: process.env.MSSQL_USER ?? "",
  SQL_PASSWORD: process.env.MSSQL_PASSWORD ?? "",
  SQL_PORT: parseInt(process.env.MSSQL_PORT || "1433", 10),
  LM_BASE_URL: process.env.LM_BASE_URL ?? "http://localhost:1234/v1",
  LM_MODEL: process.env.LM_MODEL ?? "gemma-3-27b-it-heretic-v2-i1",
  MAX_TOKENS: Number(process.env.MAX_TOKENS ?? "2048"),
};

function escapeJsonString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

async function main() {
  const questionId = process.argv[2] ? parseInt(process.argv[2], 10) : 79;
  
  if (isNaN(questionId)) {
    console.error("Invalid question ID");
    process.exit(1);
  }

  const sqlConfig: sql.config = {
    server: CONFIG.SQL_SERVER,
    database: CONFIG.SQL_DB,
    user: CONFIG.SQL_USER || undefined,
    password: CONFIG.SQL_PASSWORD || undefined,
    port: CONFIG.SQL_PORT,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
  };

  const pool = await sql.connect(sqlConfig);

  try {
    const result = await pool.request()
      .input("id", sql.Int, questionId)
      .query(`
        SELECT q.id, q.question, q.answer, q.category
        FROM dbo.questions q
        WHERE q.id = @id
      `);

    if (result.recordset.length === 0) {
      console.error(`Question ID ${questionId} not found`);
      process.exit(1);
    }

    const row = result.recordset[0] as { id: number; question: string; answer: string; category: string | null };
    
    const userContent =
      `clue_text: "${escapeJsonString(row.question)}"\n` +
      `category: "${escapeJsonString(row.category ?? "")}"\n` +
      `answer_text: "${escapeJsonString(row.answer)}"\n\n` +
      `Return the JSON now.`;

    const body = {
      model: CONFIG.LM_MODEL,
      messages: [
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      seed: 42,
      top_p: 1.0,
      max_tokens: CONFIG.MAX_TOKENS,
    };

    const bodyJson = JSON.stringify(body, null, 2);
    const bodyEscaped = bodyJson.replace(/`/g, '\\`').replace(/\$/g, '\\$');

    console.log(`\n# Curl command for question ID ${questionId}:`);
    console.log(`curl -X POST "${CONFIG.LM_BASE_URL}/chat/completions" \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '${bodyJson}'\n`);

    console.log(`# Or as a one-liner (PowerShell):`);
    console.log(`curl.exe -X POST "${CONFIG.LM_BASE_URL}/chat/completions" -H "Content-Type: application/json" -d '${bodyJson.replace(/'/g, "''")}'\n`);

  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
