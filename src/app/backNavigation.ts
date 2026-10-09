import { useEffect } from "react";

type BackHandler = { handler: () => void; nested: boolean };
const handlers: BackHandler[] = [];

export function registerBackNavigation(handler: () => void, nested = false): () => void {
  const registration = { handler, nested };
  handlers.push(registration);
  return () => {
    const index = handlers.indexOf(registration);
    if (index !== -1) handlers.splice(index, 1);
  };
}

/** Nested screens consume back before the application's home/viewer handler. */
export function useBackNavigation(handler: () => void, nested = false): void {
  useEffect(() => {
    return registerBackNavigation(handler, nested);
  }, [handler, nested]);
}

export function dispatchBackNavigation(): void {
  const current = [...handlers].reverse();
  const registration = current.find((item) => item.nested) ?? current[0];
  registration?.handler();
}
