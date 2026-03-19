import { Route, Routes, Navigate } from "react-router-dom";
import { HomePage } from "./HomePage";
import { BoardPage } from "./BoardPage";
import { RootBoardRedirect } from "./RootBoardRedirect";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootBoardRedirect />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/board/:boardId" element={<BoardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
