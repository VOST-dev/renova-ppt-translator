import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

async function getParameter(name: string, withDecryption = true): Promise<string> {
  const command = new GetParameterCommand({ Name: name, WithDecryption: withDecryption });
  const response = await ssm.send(command);
  const value = response.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter not found or empty: ${name}`);
  return value;
}

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

let cachedCredentials: BasicAuthCredentials | null = null;

export async function getBasicAuthCredentials(): Promise<BasicAuthCredentials> {
  if (cachedCredentials) return cachedCredentials;

  // ローカル開発フォールバック: 環境変数が設定されていれば SSM を呼ばない
  if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS) {
    cachedCredentials = {
      username: process.env.BASIC_AUTH_USER,
      password: process.env.BASIC_AUTH_PASS,
    };
    return cachedCredentials;
  }

  const [username, password] = await Promise.all([
    getParameter("/ppt-translator/basic-auth/username", false),
    getParameter("/ppt-translator/basic-auth/password"),
  ]);

  cachedCredentials = { username, password };
  return cachedCredentials;
}
