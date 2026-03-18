// frontend/src/pages/CreateTranslationPage.tsx

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FileDropZone } from "../components/FileDropZone";
import { useCreateJob } from "../hooks/useCreateJob";
import { useLanguages } from "../hooks/useLanguages";

interface Props {
  onNavigateList: () => void;
}

export function CreateTranslationPage({ onNavigateList }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");

  const { languages, isPending: isLoadingLanguages, isError: isLanguagesError } = useLanguages();
  const { mutate, isPending: isSubmitting, error: submitError } = useCreateJob(onNavigateList);

  const sameLanguageError =
    sourceLanguage && targetLanguage && sourceLanguage === targetLanguage
      ? "翻訳元と翻訳先に同じ言語は選択できません"
      : null;

  const canSubmit =
    file !== null &&
    !fileError &&
    sourceLanguage !== "" &&
    targetLanguage !== "" &&
    sourceLanguage !== targetLanguage;

  function handleFileSelect(f: File | null, error: string | null) {
    setFile(f);
    setFileError(error);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    mutate({ file, sourceLanguage, targetLanguage });
  }

  return (
    <section>
      <button
        type="button"
        onClick={onNavigateList}
        className="mb-6 text-sm text-muted-foreground hover:text-foreground"
      >
        ← 一覧に戻る
      </button>

      <h2 className="mb-6 text-xl font-semibold">翻訳登録</h2>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
        <FileDropZone file={file} error={fileError} onFileSelect={handleFileSelect} />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="source-language">
              翻訳元言語
            </label>
            <select
              id="source-language"
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              disabled={isLoadingLanguages || isLanguagesError}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">{isLoadingLanguages ? "読み込み中..." : "選択してください"}</option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="target-language">
              翻訳先言語
            </label>
            <select
              id="target-language"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              disabled={isLoadingLanguages || isLanguagesError}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">{isLoadingLanguages ? "読み込み中..." : "選択してください"}</option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLanguagesError && <p className="text-sm text-red-600">言語の取得に失敗しました</p>}
        {sameLanguageError && <p className="text-sm text-red-600">{sameLanguageError}</p>}
        {submitError && (
          <p className="text-sm text-red-600">
            エラーが発生しました。時間をおいて再度お試しください。
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          翻訳を開始
        </button>
      </form>
    </section>
  );
}
