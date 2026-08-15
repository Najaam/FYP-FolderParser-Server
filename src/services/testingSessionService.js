const sessions = new Map();

function getSessionKey(folderPath, entryFile) {
  return `${String(folderPath || "").trim()}::${String(entryFile || "src/server.js").trim()}`;
}

function resolveUserStory({ folderPath, entryFile, moduleIndex = 0, userStory }) {
  const key = getSessionKey(folderPath, entryFile);
  const submittedStory = String(userStory || "").trim();
  const numericModuleIndex = Number(moduleIndex) || 0;

  if (submittedStory) {
    sessions.set(key, { userStory: submittedStory, updatedAt: new Date().toISOString() });
    return submittedStory;
  }

  if (numericModuleIndex === 0) {
    sessions.delete(key);
    return "";
  }

  return sessions.get(key)?.userStory || "";
}

module.exports = { resolveUserStory };
