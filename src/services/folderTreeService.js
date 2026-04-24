function buildFolderTree(files) {
  const root = {
    name: "uploaded-folder",
    type: "folder",
    children: []
  };

  for (const file of files) {
    const parts = file.relativePath.split(/[\\/]/);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      let existingNode = current.children.find((child) => child.name === part);

      if (!existingNode) {
        existingNode = {
          name: part,
          type: isFile ? "file" : "folder",
          children: isFile ? undefined : []
        };

        if (isFile) {
          existingNode.extension = file.extension;
          existingNode.parseSuccess = file.parseResult.parseSuccess;
          existingNode.summary = file.parseResult.summary || null;
        }

        current.children.push(existingNode);
      }

      if (!isFile) {
        current = existingNode;
      }
    }
  }

  return root;
}

module.exports = { buildFolderTree };