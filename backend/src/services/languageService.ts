import { ListLanguagesCommand, TranslateClient } from "@aws-sdk/client-translate";

const client = new TranslateClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export const languageService = {
  async listLanguages(): Promise<Array<{ code: string; name: string }>> {
    const command = new ListLanguagesCommand({});
    const response = await client.send(command);
    return (response.Languages ?? []).map((lang) => ({
      code: lang.LanguageCode ?? "",
      name: lang.LanguageName ?? "",
    }));
  },
};
