import { useQuery } from "@tanstack/react-query";
import { fetchJobs } from "../lib/api";
import { jobKeys } from "../lib/queryKeys";

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.list(),
    queryFn: fetchJobs,
  });
}
