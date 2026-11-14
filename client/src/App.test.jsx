
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import App from "./App";

vi.mock("./pages/Auth", () => ({
  default: () => <div>Login Page</div>,
}));

vi.mock("./pages/EditorPage", () => ({
  default: () => <div>Editor Page</div>,
}));

describe("App protected routes", () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("redirects unauthenticated users to login", async () => {
    window.history.pushState({}, "", "/editor/test-room");

    render(<App />);

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Editor Page")).not.toBeInTheDocument();
  });

  it("allows authenticated users to access the editor", async () => {
    sessionStorage.setItem("token", "test-jwt-token");

    window.history.pushState({}, "", "/editor/test-room");

    render(<App />);

    expect(await screen.findByText("Editor Page")).toBeInTheDocument();
  });
});
