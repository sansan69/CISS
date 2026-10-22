import { onAuthStateChanged, type User } from "firebase/auth";

import { auth } from "@/lib/firebase";

const AUTH_READY_TIMEOUT_MS = 4000;

async function waitForCurrentUser(): Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      resolve(auth.currentUser);
    }, AUTH_READY_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    });
  });
}

export async function authorizedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
) {
  init.signal?.throwIfAborted();
  const currentUser = await waitForCurrentUser();
  init.signal?.throwIfAborted();
  if (!currentUser) {
    throw new Error("You must be signed in to perform this action.");
  }

  const makeRequest = async (forceRefresh = false) => {
    init.signal?.throwIfAborted();
    const token = await currentUser.getIdToken(forceRefresh);
    init.signal?.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    return fetch(input, {
      ...init,
      headers,
    });
  };

  const response = await makeRequest(false);
  if (response.status !== 401) {
    return response;
  }

  return makeRequest(true);
}
