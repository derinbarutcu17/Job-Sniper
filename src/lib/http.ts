import type { Dependencies, HttpResponseLike } from "../types.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; ClawJobSniper/1.0; +https://github.com/derinbarutcu17/claw-job-sniper)";

function adaptResponse(response: Response): HttpResponseLike {
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    json: () => response.json(),
  };
}

export function createDefaultDependencies(): Dependencies {
  return {
    fetch: async (input, init) => {
      const response = await fetch(input, {
        ...init,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
          ...(init?.headers ?? {}),
        },
      });
      return adaptResponse(response);
    },
    now: () => new Date(),
  };
}
