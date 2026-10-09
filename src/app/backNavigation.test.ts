import { describe, expect, it, vi } from "vitest";
import { dispatchBackNavigation, registerBackNavigation } from "./backNavigation";

describe("Android and keyboard back navigation", () => {
  it("consumes back only in the nested screen even when the parent registers later", () => {
    const child = vi.fn();
    const parent = vi.fn();
    const unregisterChild = registerBackNavigation(child, true);
    const unregisterParent = registerBackNavigation(parent);
    try {
      dispatchBackNavigation();
      expect(child).toHaveBeenCalledOnce();
      expect(parent).not.toHaveBeenCalled();
      unregisterChild();
      dispatchBackNavigation();
      expect(parent).toHaveBeenCalledOnce();
    } finally { unregisterChild(); unregisterParent(); }
  });
  it("uses the newest nested screen and restores the earlier handler after cleanup", () => {
    const first = vi.fn();
    const second = vi.fn();
    const cleanupFirst = registerBackNavigation(first, true);
    const cleanupSecond = registerBackNavigation(second, true);
    try {
      dispatchBackNavigation();
      expect(second).toHaveBeenCalledOnce();
      expect(first).not.toHaveBeenCalled();
      cleanupSecond();
      dispatchBackNavigation();
      expect(first).toHaveBeenCalledOnce();
    } finally { cleanupFirst(); cleanupSecond(); }
  });
  it("is safe without active screens", () => {
    expect(() => dispatchBackNavigation()).not.toThrow();
  });
});
