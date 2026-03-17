import { Download } from "lucide-react";
import { useDownloadJob } from "../hooks/useDownloadJob";

type Props = {
  jobId: string;
};

export function DownloadButton({ jobId }: Props) {
  const { mutate, isPending } = useDownloadJob();

  return (
    <button
      type="button"
      onClick={() => mutate(jobId)}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="size-3.5" />
      {isPending ? "取得中..." : "ダウンロード"}
    </button>
  );
}
