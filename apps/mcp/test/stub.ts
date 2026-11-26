export interface RecordedRequest {
  url: string;
  path: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

export interface StubResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface StubbedFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

export function stubFetch(respond: (request: RecordedRequest) => StubResponse): StubbedFetch {
  const requests: RecordedRequest[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const request: RecordedRequest = {
      url: url.toString(),
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const { status, body, headers } = respond(request);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { fetch: fetchStub, requests };
}

export function stubRoutes(routes: Record<string, StubResponse | ((request: RecordedRequest) => StubResponse)>): StubbedFetch {
  return stubFetch((request) => {
    const route = routes[`${request.method} ${request.path}`];
    if (!route) return { status: 404, body: { error: "not_found" } };
    return typeof route === "function" ? route(request) : route;
  });
}

export function instantTiming() {
  let clock = 0;
  const waits: number[] = [];
  return {
    waits,
    timing: {
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms;
      },
    },
  };
}
