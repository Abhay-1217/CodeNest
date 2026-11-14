
const axios = require("axios");

const JUDGE0_URL =
  process.env.JUDGE0_API_URL || "https://ce.judge0.com";

const LANGUAGE_IDS = {
  javascript: 102,
  python: 109,
  java: 91,
  cpp: 105,
};

async function executeCode(code, language) {
  if (typeof code !== "string" || !code.trim()) {
    throw new Error("Code cannot be empty.");
  }

  if (code.length > 20000) {
    throw new Error("Code exceeds the 20,000 character limit.");
  }

  const languageId = LANGUAGE_IDS[language];

  if (!languageId) {
    throw new Error("Unsupported programming language.");
  }

  const response = await axios.post(
    `${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`,
    {
      source_code: code,
      language_id: languageId,
      cpu_time_limit: 5,
      wall_time_limit: 10,
      memory_limit: 128000,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const result = response.data;

  const accepted = result.status?.id === 3;

  return {
    stdout: result.stdout || "",
    stderr:
      result.stderr ||
      result.compile_output ||
      result.message ||
      (accepted ? "" : result.status?.description || "Execution failed."),
    exitCode: accepted ? 0 : 1,
    status: result.status?.description || "Unknown",
    time: result.time || null,
    memory: result.memory || null,
  };
}

module.exports = executeCode;
