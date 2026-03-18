import { useMutation, useQueryClient } from "@tanstack/react-query";

import { type CreateJobResponse, createJob, fetchUploadUrl } from "../lib/api";
import { jobKeys } from "../lib/queryKeys";

interface CreateJobParams {
  file: File;
  sourceLanguage: string;
  targetLanguage: string;
}

export function useCreateJob(onSuccess: () => void) {
  const queryClient = useQueryClient();

  return useMutation<CreateJobResponse, Error, CreateJobParams>({
    mutationFn: async ({ file, sourceLanguage, targetLanguage }) => {
      // Step 1: 署名付きアップロードURLを取得
      const { uploadUrl, key } = await fetchUploadUrl(file.name, file.type);

      // Step 2: S3へ直接PUT（apiFetch ではなく生の fetch を使う）
      // apiFetch は Authorization ヘッダーを付与するため S3 署名付きURLに送ると403になる。
      // Content-Type は fetchUploadUrl に渡した file.type と必ず一致させること。
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) {
        throw new Error(`S3 upload failed: ${uploadRes.status}`);
      }

      // Step 3: 翻訳ジョブを作成（HTTP 201）
      return createJob({
        sourceKey: key,
        sourceLanguage,
        targetLanguage,
        fileName: file.name,
      });
    },
    onSuccess: () => {
      // TanStack Query は mutation 成功を自動検知しない。
      // 明示的に invalidate してジョブ一覧を再フェッチさせる。
      queryClient.invalidateQueries({ queryKey: jobKeys.list() });
      onSuccess();
    },
  });
}
