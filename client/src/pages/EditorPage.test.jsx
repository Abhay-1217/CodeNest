
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import EditorPage from "./EditorPage";

const { socketMock, socketHandlers, toastMock } = vi.hoisted(() => {
    const handlers = {};

    const toast = vi.fn();
    toast.success = vi.fn();
    toast.error = vi.fn();

    return {
        socketHandlers: handlers,
        toastMock: toast,
        socketMock: {
            on: vi.fn((event, callback) => {
                if (!handlers[event]) handlers[event] = [];
                handlers[event].push(callback);
            }),
            off: vi.fn((event, callback) => {
                if (handlers[event]) {
                    handlers[event] = handlers[event].filter(
                        (handler) => handler !== callback
                    );
                }
            }),
            emit: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            connected: false,
            id: "test-socket-123",
        },
    };
});

vi.mock("../socket.js", () => ({
    socket: socketMock,
}));

vi.mock("../components/Editor", () => ({
    default: ({ codeRef }) => (
        <>
            <div data-testid="editor-mock">Editor Mock</div>
            <button
                onClick={() => {
                    codeRef.current = "console.log('Hello CodeCollab')";
                }}
            >
                Set Test Code
            </button>
        </>
    ),
}));

vi.mock("react-hot-toast", () => ({
    toast: toastMock,
}));

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
    },
}));

function triggerSocket(event, ...args) {
    const handlers = socketHandlers[event] || [];

    handlers.forEach((handler) => {
        handler(...args);
    });
}

function LocationDisplay() {
    const location = useLocation();

    return (
        <div data-testid="current-path">
            {location.pathname}
        </div>
    );
}

function renderEditorPage() {
    return render(
        <MemoryRouter initialEntries={["/editor/test-room-123"]}>
            <Routes>
                <Route
                    path="/editor/:roomId"
                    element={<EditorPage />}
                />
                <Route
                    path="/"
                    element={<div>Home Page</div>}
                />
                <Route
                    path="/login"
                    element={<div>Login Page</div>}
                />
            </Routes>

            <LocationDisplay />
        </MemoryRouter>
    );
}

describe("EditorPage component", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        Object.keys(socketHandlers).forEach((event) => {
            delete socketHandlers[event];
        });

        sessionStorage.clear();
        sessionStorage.setItem("token", "test-jwt-token");
        sessionStorage.setItem("username", "abhay");
    });

    it("renders the editor page correctly", async () => {
        renderEditorPage();

        expect(
            screen.getByRole("heading", { name: "Pair Editor" })
        ).toBeInTheDocument();

        expect(await screen.findByTestId("editor-mock"))
            .toBeInTheDocument();

        expect(
            screen.getByRole("button", { name: "Run Code" })
        ).toBeInTheDocument();

        expect(
            screen.getByRole("button", { name: "Leave Room" })
        ).toBeInTheDocument();
    });

    it("connects to Socket.IO when the editor page loads", () => {
        renderEditorPage();

        expect(socketMock.connect).toHaveBeenCalledTimes(1);

        expect(socketMock.on).toHaveBeenCalledWith(
            "connect",
            expect.any(Function)
        );
    });

    it("joins the requested room after socket connection", () => {
        renderEditorPage();

        act(() => {
            triggerSocket("connect");
        });

        expect(socketMock.emit).toHaveBeenCalledWith(
            "join",
            { roomId: "test-room-123" }
        );
    });

    it("displays connected participants after joining", () => {
        renderEditorPage();

        act(() => {
            triggerSocket("joined", {
                clients: [
                    {
                        socketId: "socket-123",
                        username: "abhay",
                    },
                    {
                        socketId: "socket-456",
                        username: "teammate",
                    },
                ],
                username: "abhay",
                socketId: "socket-123",
            });
        });

        expect(screen.getByText("Connected")).toBeInTheDocument();
        expect(screen.getByText("teammate")).toBeInTheDocument();

        expect(screen.getAllByText("abhay").length).toBeGreaterThanOrEqual(1);
    });

    it("redirects to home when room access is denied", () => {
        renderEditorPage();

        act(() => {
            triggerSocket("room:error", {
                message: "You are not authorized to access this room",
            });
        });

        expect(toastMock.error).toHaveBeenCalledWith(
            "You are not authorized to access this room"
        );

        expect(screen.getByText("Home Page")).toBeInTheDocument();
        expect(screen.getByTestId("current-path")).toHaveTextContent("/");
    });

    it("disconnects the socket and removes listeners when unmounted", () => {
        const { unmount } = renderEditorPage();

        unmount();

        expect(socketMock.disconnect).toHaveBeenCalled();

        expect(socketMock.off).toHaveBeenCalledWith(
            "connect",
            expect.any(Function)
        );

        expect(socketMock.off).toHaveBeenCalledWith(
            "joined",
            expect.any(Function)
        );

        expect(socketMock.off).toHaveBeenCalledWith(
            "room:error",
            expect.any(Function)
        );
    });

    it("executes code successfully and displays the output", async () => {
        axios.post.mockResolvedValueOnce({
            data: {
                stdout: "Hello CodeCollab",
                stderr: "",
                exitCode: 0,
            },
        });

        renderEditorPage();

        fireEvent.click(screen.getByRole("button", { name: "Set Test Code" }));

        fireEvent.click(screen.getByRole("button", { name: "Run Code" }));

        expect(await screen.findByText("Hello CodeCollab"))
            .toBeInTheDocument();

        expect(axios.post).toHaveBeenCalledWith(
            `${import.meta.env.VITE_BACKEND_URL}/run`,
            {
                code: "console.log('Hello CodeCollab')",
                language: "javascript",
                roomId: "test-room-123",
            },
            {
                headers: {
                    Authorization: "Bearer test-jwt-token",
                },
            }
        );

        expect(screen.getByText(/Success/)).toBeInTheDocument();
    });

    it("displays an error when code execution fails", async () => {
        axios.post.mockRejectedValueOnce({
            response: {
                data: {
                    message: "Code execution failed",
                },
            },
        });

        renderEditorPage();

        fireEvent.click(screen.getByRole("button", { name: "Set Test Code" }));

        fireEvent.click(screen.getByRole("button", { name: "Run Code" }));

        expect(await screen.findByText("Code execution failed"))
            .toBeInTheDocument();

        expect(toastMock.error).toHaveBeenCalledWith(
            "Code execution failed"
        );

        expect(screen.getByText(/Runtime Error/)).toBeInTheDocument();
    });


    it("sends an invitation successfully", async () => {
        axios.post.mockResolvedValueOnce({
            data: {
                message: "Invitation sent successfully.",
            },
        });

        renderEditorPage();

        fireEvent.click(
            screen.getByRole("button", { name: /Live Session/ })
        );

        const emailInput = screen.getByPlaceholderText(
            "Enter collaborator's email"
        );

        fireEvent.change(emailInput, {
            target: { value: "teammate@example.com" },
        });

        fireEvent.click(
            screen.getByRole("button", { name: "Invite User" })
        );

        expect(await screen.findByDisplayValue("")).toBeInTheDocument();

        expect(axios.post).toHaveBeenCalledWith(
            `${import.meta.env.VITE_BACKEND_URL}/rooms/test-room-123/invite`,
            { email: "teammate@example.com" },
            {
                headers: {
                    Authorization: "Bearer test-jwt-token",
                },
            }
        );

        expect(toastMock.success).toHaveBeenCalledWith(
            "Invitation sent successfully."
        );
    });


    it("displays an error when invitation fails", async () => {
        axios.post.mockRejectedValueOnce({
            response: {
                data: {
                    message: "User is not registered",
                },
            },
        });

        renderEditorPage();

        fireEvent.click(
            screen.getByRole("button", { name: /Live Session/ })
        );

        const emailInput = screen.getByPlaceholderText(
            "Enter collaborator's email"
        );

        fireEvent.change(emailInput, {
            target: { value: "unknown@example.com" },
        });

        fireEvent.click(
            screen.getByRole("button", { name: "Invite User" })
        );

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalledWith(
                "User is not registered"
            );
        });
    });


    it("prevents sending an invitation with an empty email", () => {
        renderEditorPage();

        fireEvent.click(
            screen.getByRole("button", { name: /Live Session/ })
        );

        const emailInput = screen.getByPlaceholderText(
            "Enter collaborator's email"
        );

        fireEvent.submit(emailInput.closest("form"));

        expect(toastMock.error).toHaveBeenCalledWith(
            "Please enter an email address."
        );

        expect(axios.post).not.toHaveBeenCalled();
    });

});
