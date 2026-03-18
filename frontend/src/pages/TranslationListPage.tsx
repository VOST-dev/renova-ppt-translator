import { Loader2 } from "lucide-react";
import { TranslationTable } from "../components/TranslationTable";
import { useJobs } from "../hooks/useJobs";

interface Props {
  onNavigateCreate: () => void;
}

export function TranslationListPage({ onNavigateCreate }: Props) {
  const { data, isPending, isError } = useJobs();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">翻訳ジョブ一覧</h2>
        <button
          type="button"
          onClick={onNavigateCreate}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          翻訳追加
        </button>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          <span>読み込み中...</span>
        </div>
      )}

      {isError && (
        <p className="py-8 text-center text-sm text-red-600">
          データの取得に失敗しました。時間をおいて再度お試しください。
        </p>
      )}

      {data && data.jobs.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">翻訳ジョブがありません</p>
      )}

      {data && data.jobs.length > 0 && <TranslationTable jobs={data.jobs} />}
    </section>
  );
}
