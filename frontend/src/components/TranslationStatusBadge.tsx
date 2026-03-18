import type { Job } from "../lib/api";

type Props = {
  status: Job["status"];
};

const STATUS_CONFIG: Record<Job["status"], { label: string; className: string }> = {
  SUBMITTED: {
    label: "待機中",
    className: "bg-gray-100 text-gray-700",
  },
  IN_PROGRESS: {
    label: "翻訳中",
    className: "bg-blue-100 text-blue-700",
  },
  COMPLETED: {
    label: "完了",
    className: "bg-green-100 text-green-700",
  },
  FAILED: {
    label: "失敗",
    className: "bg-red-100 text-red-700",
  },
  STOP_REQUESTED: {
    label: "停止中",
    className: "bg-yellow-100 text-yellow-700",
  },
  STOPPED: {
    label: "停止済",
    className: "bg-gray-100 text-gray-500",
  },
};

export function TranslationStatusBadge({ status }: Props) {
  const { label, className } = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
