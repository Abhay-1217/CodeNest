
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { toast } from "react-hot-toast";
import Home from "./Home";

vi.mock("react-hot-toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
  path="/editor/:roomId"
  element={<div>Editor Page</div>}
/>
      </Routes>
      <LocationDisplay />
    </MemoryRouter>
  );
}

describe("Home component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the logout button when a user is logged in", () => {
    sessionStorage.setItem("token", "test-jwt-token");
    sessionStorage.setItem("username", "test_user");

    renderHome();

    expect(
      screen.getByRole("button", { name: "Logout" })
    ).toBeInTheDocument();
  });

  it("logs out and clears session storage", async () => {
    const user = userEvent.setup();

    sessionStorage.setItem("token", "test-jwt-token");
    sessionStorage.setItem("username", "test_user");

    renderHome();

    await user.click(
      screen.getByRole("button", { name: "Logout" })
    );

    expect(sessionStorage.getItem("token")).toBeNull();
    expect(sessionStorage.getItem("username")).toBeNull();

    expect(toast.success).toHaveBeenCalledWith(
      "Logged out successfully"
    );

    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.getByTestId("current-path")).toHaveTextContent("/login");
  });

  it("does not show the logout button when no user is logged in", () => {
    renderHome();

    expect(
      screen.queryByRole("button", { name: "Logout" })
    ).not.toBeInTheDocument();
  });

  it("creates a room successfully", async () => {
    const user = userEvent.setup();

    sessionStorage.setItem("token", "test-jwt-token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          room: { id: "test-room-123" },
        }),
      })
    );

    renderHome();

    await user.click(
      screen.getByRole("link", { name: "Create a new room" })
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/rooms"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-jwt-token",
          }),
        })
      );

      expect(screen.getByPlaceholderText("Room ID"))
        .toHaveValue("test-room-123");

      expect(toast.success).toHaveBeenCalledWith(
        "Room created successfully"
      );
    });
  });

  it("displays an error when room creation fails", async () => {
    const user = userEvent.setup();

    sessionStorage.setItem("token", "test-jwt-token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          message: "Unable to create room",
        }),
      })
    );

    renderHome();

    await user.click(
      screen.getByRole("link", { name: "Create a new room" })
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Unable to create room"
      );
    });
  });

  it("redirects to login when creating a room without authentication", async () => {
    const user = userEvent.setup();

    renderHome();

    await user.click(
      screen.getByRole("link", { name: "Create a new room" })
    );

    expect(toast.error).toHaveBeenCalledWith(
      "Please login first"
    );

    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.getByTestId("current-path"))
      .toHaveTextContent("/login");
  });
});

  it("joins a room successfully with a room ID and username", async () => {
    const user = userEvent.setup();

    renderHome();

    await user.type(
      screen.getByPlaceholderText("Room ID"),
      "test-room-123"
    );

    await user.type(
      screen.getByPlaceholderText("Username"),
      "abhay"
    );

    await user.click(
      screen.getByRole("button", { name: "Join Room" })
    );

    expect(sessionStorage.getItem("username")).toBe("abhay");

    expect(screen.getByTestId("current-path"))
      .toHaveTextContent("/editor/test-room-123");
  });

  it("displays an error when room ID is missing", async () => {
    const user = userEvent.setup();

    renderHome();

    await user.type(
      screen.getByPlaceholderText("Username"),
      "abhay"
    );

    await user.click(
      screen.getByRole("button", { name: "Join Room" })
    );

    expect(toast.error).toHaveBeenCalledWith(
      "Please enter a room ID and username"
    );

    expect(screen.getByTestId("current-path"))
      .toHaveTextContent("/");
  });

  it("displays an error when username is missing", async () => {
    const user = userEvent.setup();

    renderHome();

    await user.type(
      screen.getByPlaceholderText("Room ID"),
      "test-room-123"
    );

    await user.click(
      screen.getByRole("button", { name: "Join Room" })
    );

    expect(toast.error).toHaveBeenCalledWith(
      "Please enter a room ID and username"
    );

    expect(screen.getByTestId("current-path"))
      .toHaveTextContent("/");
  });
