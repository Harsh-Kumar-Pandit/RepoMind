import Editor from "@monaco-editor/react";
import { LoadingSpinner } from "../shared/Loading.jsx";

const LANGUAGE_EXTENSIONS = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  json: "json",
  html: "html",
  css: "css",
  md: "markdown",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  yaml: "yaml",
  yml: "yaml",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
};

function getLanguageFromPath(filePath = "") {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] || "plaintext";
}

export function WorkspaceEditor({
  filePath,
  content,
  onChange,
  onSave,
  readOnly = false,
}) {
  const language = getLanguageFromPath(filePath);

  function handleEditorMount(editor, monaco) {
    // Add Cmd+S / Ctrl+S keybinding for explicit manual save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (onSave) onSave();
    });
  }

  return (
    <div className="flex-1 w-full h-full min-h-0 relative bg-white">
      <Editor
        height="100%"
        language={language}
        value={content}
        onChange={(val) => onChange(val || "")}
        onMount={handleEditorMount}
        theme="vs"
        loading={<LoadingSpinner label="Loading Monaco editor..." />}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          lineNumbers: "on",
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          readOnly,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
        }}
      />
    </div>
  );
}

export default WorkspaceEditor;
