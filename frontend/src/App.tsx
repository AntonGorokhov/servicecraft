import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { ArticlesPage } from "./pages/ArticlesPage";
import { ArticleDetailPage } from "./pages/ArticleDetailPage";
import { ClusterMapPage } from "./pages/ClusterMapPage";
import { DialogGraphPage } from "./pages/DialogGraphPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/articles" element={<ArticlesPage />} />
          <Route path="/articles/:id" element={<ArticleDetailPage />} />
          <Route path="/clusters" element={<ClusterMapPage />} />
          <Route path="/graph" element={<DialogGraphPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/articles" replace />} />
    </Routes>
  );
}
