import { useRef, useState } from "react";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

interface Props {
  file: File | null;
  error: string | null;
  onFileSelect: (file: File | null, error: string | null) => void;
}

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".pptx")) {
    return ".pptx ファイルを選択してください";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "ファイルサイズは 100MB 以下にしてください";
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropZone({ file, error, onFileSelect }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    const err = validateFile(f);
    onFileSelect(err ? null : f, err);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    // 同じファイルを再選択できるようにリセット
    e.target.value = "";
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
      >
        {file ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium">ファイルをドラッグ&ドロップ</p>
            <p className="text-xs text-muted-foreground">または クリックして選択</p>
            <p className="text-xs text-muted-foreground">.pptx / 最大 100MB</p>
          </div>
        )}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <input ref={inputRef} type="file" accept=".pptx" className="hidden" onChange={handleChange} />
    </div>
  );
}
