export const jobKeys = {
  all: ["jobs"] as const,
  list: () => [...jobKeys.all, "list"] as const,
  detail: (id: string) => [...jobKeys.all, "detail", id] as const,
};

export const languageKeys = {
  all: ["languages"] as const,
  list: () => [...languageKeys.all, "list"] as const,
};
