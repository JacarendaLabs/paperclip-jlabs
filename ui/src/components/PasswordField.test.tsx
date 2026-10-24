// @vitest-environment jsdom

import { act as reactAct } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PasswordField } from "./PasswordField";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("PasswordField", () => {
  let container: HTMLElement;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await reactAct(async () => { root?.unmount(); });
    container.remove();
  });

  async function render() {
    root = createRoot(container);
    await reactAct(async () => {
      root!.render(<PasswordField id="password" name="password" defaultValue="hunter2" />);
    });
    const input = container.querySelector("input") as HTMLInputElement;
    const toggle = container.querySelector("button") as HTMLButtonElement;
    return { input, toggle };
  }

  it("hides the password until the toggle is pressed", async () => {
    const { input } = await render();
    expect(input.type).toBe("password");
  });

  // The attribute, not a class or an icon: anything else can pass while the
  // characters stay masked.
  it("reveals and re-hides the actual input type on click", async () => {
    const { input, toggle } = await render();

    await reactAct(async () => { toggle.click(); });
    expect(input.type).toBe("text");

    await reactAct(async () => { toggle.click(); });
    expect(input.type).toBe("password");
  });

  it("tells assistive tech which state it is in", async () => {
    const { toggle } = await render();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Show password");

    await reactAct(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Hide password");
  });

  it("does not submit the form it sits in", async () => {
    const { toggle } = await render();
    expect(toggle.type).toBe("button");
  });

  it("keeps the value intact across a reveal", async () => {
    const { input, toggle } = await render();
    await reactAct(async () => { toggle.click(); });
    expect(input.value).toBe("hunter2");
  });
});
