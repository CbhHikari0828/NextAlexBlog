export const ADMIN_UNAUTHORIZED_EVENT = "nextalex:admin-unauthorized";

export async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? "same-origin",
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
  }

  return response;
}
