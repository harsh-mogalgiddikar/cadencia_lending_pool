import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/app/Dashboard";
import Kyc from "./pages/app/Kyc";
import Borrow from "./pages/app/Borrow";
import Lend from "./pages/app/Lend";
import Score from "./pages/app/Score";
import AdminKyc from "./pages/admin/AdminKyc";
import AdminLoans from "./pages/admin/AdminLoans";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route element={<AppLayout />}>
            <Route path="/app/dashboard" element={<Dashboard />} />
            <Route path="/app/kyc" element={<Kyc />} />
            <Route path="/app/borrow" element={<Borrow />} />
            <Route path="/app/lend" element={<Lend />} />
            <Route path="/app/score" element={<Score />} />
          </Route>
          <Route element={<AppLayout admin />}>
            <Route path="/admin/kyc" element={<AdminKyc />} />
            <Route path="/admin/loans" element={<AdminLoans />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
