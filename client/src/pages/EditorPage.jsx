import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import Client from "../components/Client";
const Editor = lazy(() => import("../components/Editor"));
import { socket } from "../socket.js";
import { toast } from 'react-hot-toast';
import axios from "axios";

const EditorPage = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const username = sessionStorage.getItem("username") || "User";
  const [clients, setClients] = useState([
    {
      socketId: "local",
      username,
    },
  ]);
  const [language, setLanguage] = useState("javascript");
  const [executionResult, setExecutionResult] = useState({
    stdout: "",
    stderr: "",
    exitCode: null,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [latencyMs, setLatencyMs] = useState(null);
  const [connectionQuality, setConnectionQuality] = useState("Measuring...");
  const [reconnectCount, setReconnectCount] = useState(0);
  const hasConnectedBeforeRef = useRef(false);
  const hasDisconnectedRef = useRef(false);
  const [isSynced, setIsSynced] = useState(false);
  const [isLiveSessionOpen, setIsLiveSessionOpen] = useState(false);
  const codeRef = useRef("");
  const [sharedTestResults, setSharedTestResults] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);


  useEffect(() => {
    console.log("Connecting to socket server...");

    const handleConnect = () => {
      console.log("[DEBUG] Connecting with username:", username);
      console.log("Connected to server:", socket.id);

      socket.emit("join", {
        roomId,
      });
    };

    const handleJoined = ({ clients, username, socketId }) => {
      console.log("[DEBUG] Joined username:", username);
      console.log("[DEBUG] Clients received:", clients);
      setClients(clients);
      console.log("JOINED CLIENTS:", clients);
      console.log(`${username} joined the room. Socket ID: ${socketId}`);
    };
    const handleRoomError = ({ message }) => {
      console.error("[Room Authorization]", message);

      toast.error(message || "Access denied to this room.");

      setClients([]);
      socket.disconnect();

      navigate("/");
    };
    const handleUserJoined = ({ message }) => {
      toast.success(message);
    };

    const handleUserLeft = ({ message }) => {
      toast(message, {
        icon: "👋",
      });
    };

    const handleDisconnect = (reason) => {
      console.log("Disconnected from server:", reason);
      setClients([]);
    };

    const handleConnectError = (error) => {
      console.error("Connection error:", error.message);
    };

    socket.on("connect", handleConnect);
    socket.on("joined", handleJoined);
    socket.on("user-joined", handleUserJoined);
    socket.on("user-left", handleUserLeft);
    socket.on("room:error", handleRoomError);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    let pingInterval;

    const sendPing = () => {
      if (!socket.connected) {
        setLatencyMs(null);
        setConnectionQuality("Disconnected");
        return;
      }

      const startedAt = Date.now();

      socket.emit("connection-quality:ping", startedAt, (response) => {
        if (!response || !socket.connected) return;

        const latency = Date.now() - startedAt;

        setLatencyMs(latency);

        if (latency < 50) {
          setConnectionQuality("Excellent");
        } else if (latency < 100) {
          setConnectionQuality("Good");
        } else if (latency < 200) {
          setConnectionQuality("Fair");
        } else {
          setConnectionQuality("Poor");
        }
      });
    };

    const startPingMonitoring = () => {
      clearInterval(pingInterval);
      sendPing();
      pingInterval = setInterval(sendPing, 3000);
    };



    const handlePingDisconnect = () => {
      console.log("[Connection Quality] Disconnected");

      hasDisconnectedRef.current = true;

      clearInterval(pingInterval);
      setLatencyMs(null);
      setConnectionQuality("Disconnected");
    };

    const handlePingConnect = () => {
      if (hasDisconnectedRef.current) {
        setReconnectCount((count) => count + 1);
        hasDisconnectedRef.current = false;
      }

      startPingMonitoring();
    };
    socket.on("connect", handlePingConnect);
    socket.on("disconnect", handlePingDisconnect);

    const handleReliabilityTestResult = (payload) => {
      console.log("[Reliability Lab] Shared test result:", payload);

      if (!payload?.result) return;

      setSharedTestResults((previousResults) => {
        const alreadyExists = previousResults.some(
          (item) => String(item.id) === String(payload.result.id)
        );

        if (alreadyExists) return previousResults;

        return [payload.result, ...previousResults];
      });
    };
    socket.on("reliability-test-result", handleReliabilityTestResult);

    socket.connect();

    return () => {
      console.log("Disconnecting from socket server...");

      socket.off("connect", handleConnect);
      socket.off("joined", handleJoined);
      socket.off("user-joined", handleUserJoined);
      socket.off("user-left", handleUserLeft);
      socket.off("room:error", handleRoomError);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("reliability-test-result", handleReliabilityTestResult);
      clearInterval(pingInterval);
      socket.off("connect", handlePingConnect);
      socket.off("disconnect", handlePingDisconnect);

      socket.disconnect();
    };
  }, [roomId, username]);

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      toast.success('Room ID copied to clipboard')
      // console.log("Room ID copied to clipboard:", roomId)
    }
    catch (err) {
      toast.error('Failed to copy room ID')
      //console.error("Failed to copy room ID:", err)
    }
  }
  const inviteLink = `${window.location.origin}/editor/${roomId}`;

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invitation link copied!");
    } catch (error) {
      toast.error("Failed to copy invitation link");
    }
  };
  const handleInviteUser = async (e) => {
    e.preventDefault();

    const email = inviteEmail.trim().toLowerCase();

    if (!email) {
      toast.error("Please enter an email address.");
      return;
    }

    setIsInviting(true);

    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/rooms/${roomId}/invite`,
        { email },
        {
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem("token")}`,
          },
        }
      );

      toast.success(response.data.message || "Invitation sent successfully.");
      setInviteEmail("");
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Unable to invite user."
      );
    } finally {
      setIsInviting(false);
    }
  };

  const leaveRoom = () => {
    navigate('/');
  };

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");

    toast.success("Logged out successfully");
    navigate("/login");
  };


  const handleRunCode = async () => {
    try {
      setIsRunning(true);

      setExecutionResult({
        stdout: "",
        stderr: "Running code...",
        exitCode: null,
      });

      const token = sessionStorage.getItem("token");

      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/run`,
        {
          code: codeRef.current,
          language: language,
          roomId: roomId,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setExecutionResult(response.data);

    } catch (err) {
      toast.error(
        err.response?.data?.message || "Error running code"
      );

      setExecutionResult({
        stdout: "",
        stderr:
          err.response?.data?.message ||
          "Failed to connect to server.",
        exitCode: 1,
      });

    } finally {
      setIsRunning(false);
    }
  };

  const languages = ["javascript", "python", "java", "cpp"];

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#164e63_0,#0f172a_34%,#07111f_72%)] px-5 py-6 text-slate-100 sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-7xl flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 py-2">
          <Link to="/" className="flex items-center gap-3 text-left" >
            <span className="grid size-10 place-items-center rounded-lg bg-cyan-400 font-mono text-lg font-black text-slate-950 shadow-lg shadow-cyan-400/20">
              CC
            </span>
            <span>
              <span className="block text-base font-semibold tracking-wide text-white">CodeCollab</span>
              <span className="block text-xs font-medium text-cyan-200/80">Realtime coding rooms</span>
            </span>
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 shadow-sm backdrop-blur sm:inline-flex">
              Secure shared editor
            </span>
          </Link>
          <div className="flex items-center gap-4">


            <button
              type="button"
              onClick={() => setIsLiveSessionOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isLiveSessionOpen}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-400/20 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              <span className="size-2 rounded-full bg-emerald-400" />
              Live Session · {clients.length} online
            </button>


            <button
              onClick={handleRunCode}
              disabled={isRunning}
              className="px-4 py-2 rounded-full bg-cyan-300 font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-200 focus:outline-none focus:ring-4 focus:ring-cyan-300/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? "Running..." : "Run Code"}
            </button>
            <button onClick={copyRoomId} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 shadow-sm backdrop-blur">
              Copy ROOM-ID
            </button>
            <button onClick={leaveRoom} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 shadow-sm backdrop-blur">
              Leave Room
            </button>
            <button
              onClick={handleLogout}
              className="rounded-full border border-red-400/30 bg-red-400/5 px-4 py-2 text-sm text-red-300 shadow-sm transition hover:bg-red-400/10"
            >
              Logout
            </button>
          </div>
        </header>

        {isLiveSessionOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsLiveSessionOpen(false);
              }
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="live-session-title"
              className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
                    Collaboration
                  </p>
                  <h2 id="live-session-title" className="mt-2 text-2xl font-bold text-white">
                    Live Session
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Invite teammates to collaborate in this room.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsLiveSessionOpen(false)}
                  aria-label="Close live session panel"
                  className="rounded-lg px-3 py-2 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="mt-6">
                <label htmlFor="session-room-id" className="text-sm font-semibold text-slate-300">
                  Room ID
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="session-room-id"
                    readOnly
                    value={roomId}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-3 font-mono text-sm text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={copyRoomId}
                    className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"
                  >
                    Copy ID
                  </button>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">Participants</h3>
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                    {clients.length} online
                  </span>
                </div>

                <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                  {clients.map((client) => (
                    <div
                      key={client.socketId}
                      className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-3"
                    >
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-cyan-300 font-bold text-slate-950">
                        {(client.username || "A").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {client.username}
                          {client.socketId === socket.id ? " (You)" : ""}
                        </p>
                        <p className="text-xs text-slate-400">Connected participant</p>
                      </div>
                      <span className="size-2 rounded-full bg-emerald-400" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4">
                <h3 className="font-semibold text-white">Invite collaborators</h3>

                <p className="mt-1 text-sm leading-5 text-slate-400">
                  Invite registered users using their email address.
                </p>

                <form onSubmit={handleInviteUser} className="mt-4 space-y-3">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Enter collaborator's email"
                    required
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                  />

                  <button
                    type="submit"
                    disabled={isInviting}
                    className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isInviting ? "Sending Invitation..." : "Invite User"}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={copyInviteLink}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
                >
                  Copy Invitation Link
                </button>
              </div>
            </section>
          </div>
        )}

        <main className="grid flex-1 gap-4 py-5 lg:grid-cols-[260px_1fr_300px]">

          {/* Left Sidebar */}
          <aside className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur">

            {/* Workspace Info */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Workspace
              </p>

              <h1 className="mt-2 text-2xl font-black text-white">
                Pair Editor
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Share context, write together, and keep everyone in the same flow.
              </p>
            </div>

            {/* Connected Users */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">

              <p className="text-sm font-semibold text-slate-200">
                Connected
              </p>

              <div className="mt-3 space-y-3">

                {clients.map((client, index) => (
                  <Client key={client.socketId} username={client.username} isCurrentUser={client.socketId === socket.id} />
                ))}

              </div>

            </div>

            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3">
              <button onClick={copyRoomId} className="w-full rounded-xl bg-cyan-300 px-6 font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-200 focus:outline-none focus:ring-4 focus:ring-cyan-300/30">
                Copy ROOM-ID
              </button>
            </div>

          </aside>

          {/* Editor Section */}
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-slate-950/50">

            {/* Editor Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">

              {/* Left Side */}
              <div className="flex items-center gap-3">

                <div className="flex gap-2">
                  <span className="size-3 rounded-full bg-rose-400" />
                  <span className="size-3 rounded-full bg-amber-300" />
                  <span className="size-3 rounded-full bg-emerald-300" />
                </div>

                <span className="font-mono text-sm text-slate-400">
                  main.js
                </span>

              </div>

              {/* Right Side */}
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">

                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-300 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-900"
                >
                  {languages.map((lang) => (
                    <option key={lang} value={lang} className="bg-slate-900 text-white">
                      {lang}
                    </option>
                  ))}
                </select>


                <span
                  className={`rounded-md px-2 py-1 ${connectionStatus === "connected" && isSynced
                    ? "bg-emerald-400/10 text-emerald-300"
                    : connectionStatus === "connected"
                      ? "bg-amber-400/10 text-amber-300"
                      : "bg-rose-400/10 text-rose-300"
                    }`}
                >
                  {connectionStatus !== "connected"
                    ? "Reconnecting..."
                    : isSynced
                      ? "Synced"
                      : "Syncing..."}
                </span>


              </div>

            </div>

            {/* Editor Body */}
            <div className="min-h-[550px] p-5">

              <Suspense
                fallback={
                  <div className="flex min-h-[550px] items-center justify-center text-slate-300">
                    Loading code editor...
                  </div>
                }
              >
                <Editor
                  language={language}
                  roomId={roomId}
                  codeRef={codeRef}
                  onSyncStatusChange={({ connectionStatus, isSynced }) => {
                    setConnectionStatus(connectionStatus);
                    setIsSynced(isSynced);
                  }}
                  onReconnect={() => {
                    setReconnectCount((count) => count + 1);
                  }}
                  sharedTestResults={sharedTestResults}
                />
              </Suspense>

            </div>

          </section>

          {/* Activity Panel */}
          <aside className="grid gap-4">

            {/* Session Card */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur">
              <p className="text-sm font-semibold text-slate-200">
                Connection Quality
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 p-3">
                  <span className="block text-2xl font-black text-white">
                    {clients.length}
                  </span>
                  <span className="text-xs text-slate-500">Online</span>
                </div>

                <div className="rounded-xl bg-white/5 p-3">
                  <span className="block text-2xl font-black text-white">
                    {latencyMs === null ? "--" : `${latencyMs} ms`}
                  </span>
                  <span className="text-xs text-slate-500">Latency</span>
                </div>

                <div className="rounded-xl bg-white/5 p-3">
                  <span className="block text-lg font-bold text-white">
                    {connectionQuality}
                  </span>
                  <span className="text-xs text-slate-500">Quality</span>
                </div>

                <div className="rounded-xl bg-white/5 p-3">
                  <span className="block text-2xl font-black text-white">
                    {reconnectCount}
                  </span>
                  <span className="text-xs text-slate-500">Reconnects</span>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-sm">
                <span
                  className={`size-2 rounded-full ${socket.connected ? "bg-emerald-400" : "bg-red-400"
                    }`}
                />
                <span className="text-slate-300">
                  {socket.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
            {/* Activity Feed */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur">

              <p className="text-sm font-semibold text-slate-200">
                Activity
              </p>

              <div className="mt-4 space-y-4">

                <div className="flex gap-3">

                  <span className="mt-1 size-2 rounded-full bg-cyan-300" />

                  <div>
                    <p className="text-sm text-slate-300">
                      <span className="font-semibold text-white">
                        {username}
                      </span>{" "}
                      created this room
                    </p>

                    <p className="text-xs text-slate-500">
                      just now
                    </p>
                  </div>

                </div>

              </div>

            </div>

          </aside>

        </main>
        <div className="mt-4 bg-black rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">
              Terminal
            </h3>

            {executionResult.exitCode === 0 && (
              <span className="text-green-400 text-sm">
                ✓ Success
              </span>
            )}

            {executionResult.exitCode === 1 && (
              <span className="text-red-400 text-sm">
                ✗ Runtime Error
              </span>
            )}

            {executionResult.exitCode === null && isRunning && (
              <span className="text-yellow-400 text-sm">
                Running...
              </span>
            )}
          </div>

          <pre
            className={`whitespace-pre-wrap font-mono text-sm ${executionResult.exitCode === 1
              ? "text-red-400"
              : "text-green-400"
              }`}
          >
            {executionResult.stdout ||
              executionResult.stderr ||
              "Run your code to see the output..."}
          </pre>
        </div>
      </div>

    </div>
  );
};

export default EditorPage;