import type { Job } from "../lib/api";
import { DownloadButton } from "./DownloadButton";
import { TranslationStatusBadge } from "./TranslationStatusBadge";

type Props = {
  jobs: Job[];
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TranslationTable({ jobs }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-4 py-3 font-medium text-muted-foreground">翻訳元ファイル名</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">翻訳開始日時</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">ステータス</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">ダウンロード</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobId} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">{job.fileName}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(job.createdAt)}</td>
              <td className="px-4 py-3">
                <TranslationStatusBadge status={job.status} />
              </td>
              <td className="px-4 py-3">
                {job.status === "COMPLETED" ? <DownloadButton jobId={job.jobId} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
