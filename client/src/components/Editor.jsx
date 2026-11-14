import React, { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";
import { yCollab } from "y-codemirror.next";
import { socket } from "../socket.js";

const Editor = ({
  language,
  roomId,
  codeRef,
  onSyncStatusChange,
  onReconnect,
  sharedTestResults = [],
}) => {
  const providerRef = useRef(null);
  const ytextRef = useRef(null);
  const [sharedExtension, setSharedExtension] = useState(null);
  const [recoveryTimeMs, setRecoveryTimeMs] = useState(null);
  const disconnectTimeRef = useRef(null);
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const [totalRecoveryTimeMs, setTotalRecoveryTimeMs] = useState(0);
  const [testHistory, setTestHistory] = useState([]);

  const averageRecoveryTimeMs =
    recoveryAttempts > 0
      ? Math.round(totalRecoveryTimeMs / recoveryAttempts)
      : null;


  const runRecoverySimulation = () => {
    if (simulationRunning) return;

    const provider = providerRef.current;

    if (!provider || !provider.socket) {
      setSimulationResult("Cannot run test: Yjs provider is unavailable.");
      return;
    }

    if (!provider.socket.connected) {
      setSimulationResult("Cannot run test: wait for the connection to reconnect.");
      return;
    }

    setSimulationRunning(true);
    setSimulationResult("Disconnecting briefly, then reconnecting...");

    const startedAt = Date.now();
    let finished = false;

    const finishTest = (success, message) => {
      if (finished) return;
      finished = true;

      const elapsed = Date.now() - startedAt;
      const testId = Date.now();

      setSimulationResult(
        success
          ? `Connection recovered in ${elapsed} ms. Check that the editor is synced.`
          : message
      );
      socket.emit("reliability-test-result", {
        roomId,
        result: {
          id: testId,
          durationMs: elapsed,
          timestamp: new Date().toLocaleTimeString(),
          success,
          message: success
            ? `Connection recovered in ${elapsed} ms. Check that the editor is synced.`
            : message,
        },
      });

      setTestHistory((previousHistory) => [
        {
          id: testId,
          durationMs: elapsed,
          timestamp: new Date().toLocaleTimeString(),
          success,
        },
        ...previousHistory,
      ]);

      setSimulationRunning(false);
      window.clearTimeout(timeoutId);
    };

    const timeoutId = window.setTimeout(() => {
      finishTest(
        false,
        "Test timed out. Check the connection status and try again."
      );
    }, 15000);

    const handleConnect = () => {
      if (provider.socket.connected) {
        provider.socket.off("connect", handleConnect);
        finishTest(true, "");
      }
    };

    provider.socket.once("connect", handleConnect);

    // Force this browser's Yjs socket to reconnect.
    provider.socket.disconnect();

    window.setTimeout(() => {
      if (!finished) {
        provider.socket.connect();
      }
    }, 1000);
  };


  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [isSynced, setIsSynced] = useState(false);
  const [latencyMs, setLatencyMs] = useState(null);
  const [connectionQuality, setConnectionQuality] = useState("Measuring...");
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationResult, setSimulationResult] = useState("");

  useEffect(() => {
    if (!roomId) return undefined;

    const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
    console.log(`[Editor] Initializing Yjs for roomId: "${roomId}", backendUrl: "${backendUrl}"`);

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("codemirror");
    const provider = new SocketIOProvider(backendUrl, roomId, ydoc, {
  autoConnect: true,
  auth: {
    token: sessionStorage.getItem("token"),
  },
});

    console.log(`[Editor] Yjs provider created. Target namespace: "${backendUrl}/yjs|${roomId}"`);
    console.log("[Yjs Debug]", {
  namespace: provider.socket.nsp,
  connected: provider.socket.connected,
});


    provider.on("status", ({ status }) => {
      if (status === "disconnected" && disconnectTimeRef.current === null) {
        disconnectTimeRef.current = Date.now();
      }


      if (status === "connected" && disconnectTimeRef.current !== null) {
        const elapsed = Date.now() - disconnectTimeRef.current;

        setRecoveryTimeMs(elapsed);
        setRecoveryAttempts((previous) => previous + 1);
        setTotalRecoveryTimeMs((previous) => previous + elapsed);

        disconnectTimeRef.current = null;

        console.log(`[Reliability Lab] Recovered in ${elapsed} ms`);
      }


      setConnectionStatus(status);

      onSyncStatusChange?.({
        connectionStatus: status,
        isSynced: false,
      });

      console.log(
        `[Editor Yjs Provider] Status: "${status}" for room: "${roomId}"`
      );
    });


    provider.on("synced", (synced) => {
      setIsSynced(synced);

      onSyncStatusChange?.({
        connectionStatus: providerRef.current ? "connected" : "disconnected",
        isSynced: synced,
      });

      console.log(
        `[Editor Yjs Provider] Synced: ${synced} for room: "${roomId}"`
      );
    });

    provider.on("connection-error", (err) => {
      console.error(`[Editor Yjs Provider] Connection Error for room "${roomId}":`, err);
    });


    let hasConnectedBefore = false;
    let disconnectedAfterConnection = false;

    const handleProviderConnect = () => {
      console.log(
        `[Editor Yjs Socket] Connected to ${provider.socket.nsp}! Socket ID: ${provider.socket.id}`
      );

      if (hasConnectedBefore && disconnectedAfterConnection) {
        onReconnect?.();
        disconnectedAfterConnection = false;
        console.log("[Editor Yjs Socket] Reconnection counted");
      }

      hasConnectedBefore = true;
    };

    const handleProviderConnectError = (err) => {
      console.error(
        `[Editor Yjs Socket] Connect Error on ${provider.socket.nsp}:`,
        err.message
      );
    };

    const handleProviderDisconnect = (reason) => {
      console.warn(
        `[Editor Yjs Socket] Disconnected from ${provider.socket.nsp}:`,
        reason
      );

      if (hasConnectedBefore) {
        disconnectedAfterConnection = true;
      }
    };

    provider.socket.on("connect", handleProviderConnect);
    provider.socket.on("connect_error", handleProviderConnectError);
    provider.socket.on("disconnect", handleProviderDisconnect);


    provider.socket.on("sync-update", (data) => {
      console.log(`[Editor Yjs Socket] Received sync-update (${data?.byteLength || data?.length || 0} bytes)`);
    });

    providerRef.current = provider;
    ytextRef.current = ytext;

    const updateCodeRef = (event) => {
      codeRef.current = ytext.toString();
      console.log(`[Editor Y.Text] Updated codeRef. Current content (${codeRef.current.length} chars):`, JSON.stringify(codeRef.current));
    };

    ytext.observe(updateCodeRef);
    updateCodeRef();

    console.log(`[Editor] Attaching yCollab extension for room: "${roomId}"`);
    setSharedExtension(yCollab(ytext, provider.awareness));

    return () => {
      console.log(`[Editor] Cleaning up Yjs provider & ydoc for room: "${roomId}"`);
      ytext.unobserve(updateCodeRef);
      provider.socket.off("connect", handleProviderConnect);
      provider.socket.off("connect_error", handleProviderConnectError);
      provider.socket.off("disconnect", handleProviderDisconnect);
      provider.destroy();
      ydoc.destroy();
      providerRef.current = null;
      ytextRef.current = null;
      setConnectionStatus("connecting");
      setIsSynced(false);
      setSharedExtension(null);
    };
  }, [roomId]);

  const languageExtensions = {
    javascript: javascript(),
    python: python(),
    java: java(),
    cpp: cpp(),
  };

  const extensions = useMemo(() => {
    return [languageExtensions[language] || javascript(), sharedExtension].filter(Boolean);
  }, [language, sharedExtension]);


  return (
    <div className="h-full">

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <p className="text-cyan-200/70">Last recovery</p>
          <strong>
            {recoveryTimeMs !== null ? `${recoveryTimeMs} ms` : "No data yet"}
          </strong>
        </div>

        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <p className="text-cyan-200/70">Successful recoveries</p>
          <strong>{recoveryAttempts}</strong>
        </div>

        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <p className="text-cyan-200/70">Average recovery</p>
          <strong>
            {averageRecoveryTimeMs !== null
              ? `${averageRecoveryTimeMs} ms`
              : "No data yet"}
          </strong>
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-amber-200">
              Network Failure Simulator
            </h3>
            <p className="text-sm text-slate-400">
              Run a safe test of the simulator interface.
            </p>
          </div>

          <button
            type="button"
            onClick={runRecoverySimulation}
            disabled={simulationRunning}
            className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {simulationRunning ? "Testing..." : "Run Test"}
          </button>
        </div>

        {simulationResult && (
          <p className="mt-3 text-sm text-slate-300" role="status">
            {simulationResult}
          </p>
        )}
      </div>

      {(() => {

        const allResults = [
          ...new Map(
            [...testHistory, ...sharedTestResults].map((test) => [
              String(test.id),
              test,
            ])
          ).values(),
        ];

        const uniqueResults = [
          ...new Map(
            allResults.map((test) => [
              `${test.timestamp}-${test.durationMs}-${test.success}`,
              test,
            ])
          ).values(),
        ].slice(0, 10);


        return uniqueResults.length > 0 ? (
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">
              Test History
            </h3>

            <div className="space-y-2">
              {uniqueResults.map((test, index) => (
                <div
                  key={String(test.id)}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/70 px-3 py-2 text-sm"
                >
                  <span className="text-slate-400">
                    Test {uniqueResults.length - index} · {test.timestamp}
                  </span>

                  <span className="font-medium text-cyan-300">
                    {test.durationMs} ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}


      <CodeMirror
        height="100%"
        theme={dracula}
        extensions={extensions}
      />
    </div>
  );
};


export default Editor;