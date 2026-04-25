type StartupSummaryInput = {
  port: number;
  host: string;
  authToken: string;
  proxyToken?: string;
};

type StartupEndpoints = {
  baseUrl: string;
  adminDashboardUrl: string;
  adminApiExample: string;
  adminApiCurl: string;
};

function resolveDisplayHost(host: string): string {
  const trimmed = (host || '').trim();
  if (!trimmed || trimmed === '0.0.0.0' || trimmed === '::') return '127.0.0.1';
  return trimmed;
}

export function buildStartupEndpoints(input: StartupSummaryInput): StartupEndpoints {
  const displayHost = resolveDisplayHost(input.host);
  const baseUrl = `http://${displayHost}:${input.port}`;
  const adminApiExample = `${baseUrl}/api/settings/auth/info`;

  return {
    baseUrl,
    adminDashboardUrl: baseUrl,
    adminApiExample,
    adminApiCurl: `curl '${adminApiExample}' -H 'Authorization: Bearer ${input.authToken}'`,
  };
}

export function buildStartupSummaryLines(input: StartupSummaryInput): string[] {
  const endpoints = buildStartupEndpoints(input);

  return [
    `metapi running on ${input.host}:${input.port}`,
    `Lite console: ${endpoints.adminDashboardUrl}`,
    `Admin health API: ${endpoints.adminApiExample}`,
    `Admin curl: ${endpoints.adminApiCurl}`,
  ];
}
