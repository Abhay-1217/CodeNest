
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

const Home = lazy(() => import("./pages/Home"));
const EditorPage = lazy(() => import("./pages/EditorPage"));
const Auth = lazy(() => import("./pages/Auth"));

function ProtectedRoute({ children }) {
  const token = sessionStorage.getItem("token");

  return token ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 2000,
          style: {
            background: "#333",
            color: "#fff",
          },
        }}
      />

      <BrowserRouter>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
              Loading CodeCollab...
            </div>
          }
        >
          <Routes>
            <Route path="/login" element={<Auth />} />
            <Route path="/" element={<Home />} />

            <Route
              path="/editor/:roomId"
              element={
                <ProtectedRoute>
                  <EditorPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </>
  );
}

export default App;
