import { useQuery } from "@tanstack/react-query";
import { fetchLanguages, type Language } from "../lib/api";

const languageKeys = {
  all: ["languages"] as const,
  list: () => [...languageKeys.all, "list"] as const,
};

export function useLanguages(): {
  languages: Language[];
  isPending: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: languageKeys.list(),
    queryFn: fetchLanguages,
  });

  const languages: Language[] = query.data
    ? [...query.data.languages].sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return {
    languages,
    isPending: query.isPending,
    isError: query.isError,
  };
}
