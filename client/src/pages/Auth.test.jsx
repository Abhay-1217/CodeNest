
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "react-hot-toast";
import axios from "axios";
import Auth from "./Auth";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

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

function renderAuth() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Auth />
      <LocationDisplay />
    </MemoryRouter>
  );
}

describe("Auth component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("renders the login screen by default", () => {
    renderAuth();

    expect(
      screen.getByRole("heading", { name: "Welcome Back" })
    ).toBeInTheDocument();

    expect(
      screen.getByPlaceholderText("Email address")
    ).toBeInTheDocument();

    expect(
      screen.getByPlaceholderText("Password")
    ).toBeInTheDocument();
  });

  it("switches to the registration screen", async () => {
    const user = userEvent.setup();
    renderAuth();

    await user.click(
      screen.getByRole("button", { name: "Register" })
    );

    expect(
      screen.getByRole("heading", { name: "Create Account" })
    ).toBeInTheDocument();

    expect(
      screen.getByPlaceholderText("Username")
    ).toBeInTheDocument();
  });

  it("logs in successfully and stores the JWT", async () => {
    const user = userEvent.setup();

    axios.post.mockResolvedValue({
      data: {
        token: "test-jwt-token",
        user: {
          username: "test_user",
        },
      },
    });

    renderAuth();

    await user.type(
      screen.getByPlaceholderText("Email address"),
      "test@example.com"
    );

    await user.type(
      screen.getByPlaceholderText("Password"),
      "password123"
    );

    await user.click(
      screen.getByRole("button", { name: "Login" })
    );

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      {
        email: "test@example.com",
        password: "password123",
      }
    );

    expect(sessionStorage.getItem("token")).toBe("test-jwt-token");
    expect(sessionStorage.getItem("username")).toBe("test_user");

    expect(screen.getByTestId("current-path")).toHaveTextContent("/");
    expect(toast.success).toHaveBeenCalledWith("Login successful!");
  });

  it("displays an error when login fails", async () => {
    const user = userEvent.setup();

    axios.post.mockRejectedValue({
      response: {
        data: {
          message: "Invalid email or password.",
        },
      },
    });

    renderAuth();

    await user.type(
      screen.getByPlaceholderText("Email address"),
      "wrong@example.com"
    );

    await user.type(
      screen.getByPlaceholderText("Password"),
      "wrongpassword"
    );

    await user.click(
      screen.getByRole("button", { name: "Login" })
    );

    expect(toast.error).toHaveBeenCalledWith(
      "Invalid email or password."
    );

    expect(sessionStorage.getItem("token")).toBeNull();
  });

  it("registers a new user successfully", async () => {
    const user = userEvent.setup();

    axios.post.mockResolvedValue({
      data: {
        message: "User registered successfully.",
      },
    });

    renderAuth();

    await user.click(
      screen.getByRole("button", { name: "Register" })
    );

    await user.type(
      screen.getByPlaceholderText("Username"),
      "test_user"
    );

    await user.type(
      screen.getByPlaceholderText("Email address"),
      "test@example.com"
    );

    await user.type(
      screen.getByPlaceholderText("Password"),
      "password123"
    );

    await user.click(
      screen.getByRole("button", { name: "Register" })
    );

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/auth/register"),
      {
        username: "test_user",
        email: "test@example.com",
        password: "password123",
      }
    );

    expect(toast.success).toHaveBeenCalledWith(
      "Account created! Please log in."
    );

    expect(
      screen.getByRole("heading", { name: "Welcome Back" })
    ).toBeInTheDocument();
  });
});
