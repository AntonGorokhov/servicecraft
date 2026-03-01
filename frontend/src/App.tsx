import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { ArticlesPage } from "./pages/ArticlesPage";
import { ArticleDetailPage } from "./pages/ArticleDetailPage";
import { ClusterMapPage } from "./pages/ClusterMapPage";
import { DialogGraphPage } from "./pages/DialogGraphPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { PipelinePage } from "./pages/PipelinePage";
import { PriceTreePage } from "./pages/PriceTreePage";
import { AgentPage } from "./pages/AgentPage";
import { FAQPage } from "./pages/FAQPage";

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
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/price-tree" element={<PriceTreePage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/companies" element={<CompaniesPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/articles" replace />} />
    </Routes>
  );
}
