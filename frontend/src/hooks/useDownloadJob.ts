import { useMutation } from "@tanstack/react-query";
import { fetchDownloadUrl } from "../lib/api";

export function useDownloadJob() {
  return useMutation({
    mutationFn: (jobId: string) => fetchDownloadUrl(jobId),
    onSuccess: ({ downloadUrl }) => {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    },
  });
}
