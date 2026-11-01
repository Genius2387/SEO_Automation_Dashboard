"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Server,
  Activity,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Search,
  RefreshCw,
  Users,
  FileText,
  ChevronLeft,
  ChevronRight,
  Key,
  Lock,
  LogOut,
  Eye,
  RotateCcw,
  UserCheck,
  AlertCircle,
  Clock,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// --- Types ---
interface AdminScheduledAuditItem {
  id: string;
  userId: string;
  targetUrl: string;
  frequency: "WEEKLY" | "MONTHLY";
  isActive: boolean;
  nextRunAt: string;
  lastRunAt?: string | null;
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
  lastAudit?: {
    id: string;
    status: string;
    score: number | null;
    pdfReportUrl?: string | null;
    completedAt?: string | null;
  } | null;
}

interface QueueMetricsData {
  queueName: string;
  status: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
}

interface AdminOverviewData {
  totalAudits: number;
  completedAudits: number;
  failedAudits: number;
  queuedAudits: number;
  crawlingAudits: number;
  analyzingAudits: number;
  averageScore: number | null;
  totalUsers: number;
  recentFailures: {
    id: string;
    targetUrl: string;
    errorMessage: string | null;
    updatedAt: string;
    createdAt: string;
  }[];
  queue?: QueueMetricsData | null;
}

interface AuditRecordItem {
  id: string;
  targetUrl: string;
  status: "QUEUED" | "CRAWLING" | "ANALYZING" | "COMPLETED" | "FAILED";
  score: number | null;
  errorMessage?: string | null;
  pdfReportUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  userId?: string | null;
  rawCrawlData?: Record<string, unknown> | null;
  aiAnalysisData?: {
    audit_version?: string;
    overall_score?: number;
    executive_summary?: string;
    score_breakdown?: {
      technical?: number;
      on_page?: number;
      content?: number;
      core_web_vitals?: number;
      schema?: number;
    };
    critical_issues?: { severity?: string; title?: string; issue?: string }[];
    important_issues?: { severity?: string; title?: string; issue?: string }[];
    quick_wins?: { finding?: string; action?: string }[];
  } | null;
}

interface UserRecordItem {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "CLIENT";
  createdAt: string;
  auditCount: number;
}

interface NotificationDeliveryItem {
  id: string;
  auditId: string;
  channel: string;
  recipient: string;
  status: string;
  providerId?: string | null;
  attemptCount: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export default function AdminPortalPage() {
  // Authentication State
  const [adminKey, setAdminKey] = useState<string>("");
  const [keyInput, setKeyInput] = useState<string>("");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<"overview" | "audits" | "users" | "queue" | "schedules">("overview");

  // Scheduled Audits State
  const [adminSchedules, setAdminSchedules] = useState<AdminScheduledAuditItem[]>([]);
  const [adminSchedulesLoading, setAdminSchedulesLoading] = useState<boolean>(false);
  const [adminSchedulesError, setAdminSchedulesError] = useState<string | null>(null);
  const [triggeringScheduleId, setTriggeringScheduleId] = useState<string | null>(null);

  // Overview Tab State
  const [overviewData, setOverviewData] = useState<AdminOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState<boolean>(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Audits Tab State
  const [audits, setAudits] = useState<AuditRecordItem[]>([]);
  const [auditsLoading, setAuditsLoading] = useState<boolean>(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [auditsPagination, setAuditsPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    totalCount: 0,
    totalPages: 1,
  });
  const [auditSearch, setAuditSearch] = useState<string>("");
  const [auditStatusFilter, setAuditStatusFilter] = useState<string>("ALL");

  // Audit Detail Modal State
  const [selectedAudit, setSelectedAudit] = useState<AuditRecordItem | null>(null);
  const [retryingAuditId, setRetryingAuditId] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [adminReportMessage, setAdminReportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [notificationsList, setNotificationsList] = useState<NotificationDeliveryItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState<boolean>(false);

  // Users Tab State
  const [users, setUsers] = useState<UserRecordItem[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersPagination, setUsersPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    totalCount: 0,
    totalPages: 1,
  });
  const [userSearch, setUserSearch] = useState<string>("");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [userRoleMessage, setUserRoleMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Queue Tab State
  const [queueData, setQueueData] = useState<QueueMetricsData | null>(null);
  const [queueLoading, setQueueLoading] = useState<boolean>(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Load key from sessionStorage on mount
  useEffect(() => {
    const savedKey = typeof window !== "undefined" ? sessionStorage.getItem("edgelink_admin_key") : null;
    if (savedKey) {
      setAdminKey(savedKey);
      setIsAuthenticated(true);
    }
  }, []);

  // Standard Admin Fetch Helper
  const adminFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      if (adminKey) {
        headers.set("x-admin-key", adminKey);
      }
      return fetch(url, { ...options, headers });
    },
    [adminKey]
  );

  // --- Handlers: Authentication ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) {
      setAuthError("Please enter your Admin Secret Key.");
      return;
    }

    setAuthError(null);
    try {
      const res = await fetch("/api/admin/overview", {
        headers: { "x-admin-key": keyInput.trim() },
      });

      if (res.status === 401) {
        setAuthError("Invalid Admin Secret Key. Access rejected by server.");
        return;
      }

      const json = await res.json();
      if (!res.ok || !json.success) {
        setAuthError(json.message || "Failed to authenticate with admin server.");
        return;
      }

      const verifiedKey = keyInput.trim();
      setAdminKey(verifiedKey);
      setIsAuthenticated(true);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("edgelink_admin_key", verifiedKey);
      }
      setOverviewData(json.data);
    } catch {
      setAuthError("Connection error. Could not reach admin authentication endpoint.");
    }
  };

  const handleLogout = () => {
    setAdminKey("");
    setKeyInput("");
    setIsAuthenticated(false);
    setOverviewData(null);
    setAudits([]);
    setUsers([]);
    setQueueData(null);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("edgelink_admin_key");
    }
  };

  // --- Handlers: Fetch Overview ---
  const fetchOverview = useCallback(async () => {
    if (!isAuthenticated) return;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await adminFetch("/api/admin/overview");
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (res.status === 401) {
          setIsAuthenticated(false);
          setAuthError("Session expired or invalid key. Please re-authenticate.");
          return;
        }
        throw new Error(json.message || "Failed to load overview");
      }
      setOverviewData(json.data);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : "Error loading overview");
    } finally {
      setOverviewLoading(false);
    }
  }, [adminFetch, isAuthenticated]);

  // --- Handlers: Fetch Audits ---
  const fetchAudits = useCallback(
    async (page = 1, status = auditStatusFilter, search = auditSearch) => {
      if (!isAuthenticated) return;
      setAuditsLoading(true);
      setAuditsError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "10",
        });
        if (status && status !== "ALL") {
          params.set("status", status);
        }
        if (search.trim()) {
          params.set("search", search.trim());
        }

        const res = await adminFetch(`/api/admin/audits?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          if (res.status === 401) {
            setIsAuthenticated(false);
            setAuthError("Session expired or invalid key. Please re-authenticate.");
            return;
          }
          throw new Error(json.message || "Failed to load audits");
        }
        setAudits(json.data);
        setAuditsPagination(json.pagination);
      } catch (err) {
        setAuditsError(err instanceof Error ? err.message : "Error loading audits");
      } finally {
        setAuditsLoading(false);
      }
    },
    [adminFetch, auditSearch, auditStatusFilter, isAuthenticated]
  );

  // --- Handlers: Retry Audit ---
  const handleRetryAudit = async (auditId: string) => {
    if (!confirm(`Are you sure you want to retry failed audit ${auditId}?`)) {
      return;
    }

    setRetryingAuditId(auditId);
    setRetryMessage(null);
    try {
      const res = await adminFetch(`/api/admin/audits/${auditId}/retry`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to retry audit");
      }
      setRetryMessage({ type: "success", text: `Audit ${auditId} successfully re-enqueued for processing!` });
      // Refresh audit listings and overview
      fetchAudits(auditsPagination.page);
      if (selectedAudit && selectedAudit.id === auditId) {
        setSelectedAudit((prev) => (prev ? { ...prev, status: "QUEUED", errorMessage: null } : null));
      }
    } catch (err) {
      setRetryMessage({ type: "error", text: err instanceof Error ? err.message : "Error retrying audit" });
    } finally {
      setRetryingAuditId(null);
    }
  };

  // --- Handlers: Fetch Audit Notifications ---
  const fetchAuditNotifications = useCallback(
    async (auditId: string) => {
      if (!adminKey) return;
      setNotificationsLoading(true);
      try {
        const res = await adminFetch(`/api/audits/${auditId}/notifications`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setNotificationsList(json.data);
        } else {
          setNotificationsList([]);
        }
      } catch {
        setNotificationsList([]);
      } finally {
        setNotificationsLoading(false);
      }
    },
    [adminFetch, adminKey]
  );

  // --- Handlers: Download Audit PDF Report as Admin ---
  const handleAdminDownloadPdf = async (auditId: string) => {
    setIsDownloadingPdf(true);
    setAdminReportMessage(null);
    try {
      const res = await adminFetch(`/api/audits/${auditId}/report`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || `Download failed with HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `edgelink-audit-${auditId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setAdminReportMessage({ type: "success", text: "PDF report downloaded successfully." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to download PDF report";
      setAdminReportMessage({ type: "error", text: msg });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // --- Handlers: Generate or Regenerate PDF Report as Admin ---
  const handleAdminGeneratePdf = async (auditId: string) => {
    setIsGeneratingPdf(true);
    setAdminReportMessage(null);
    try {
      const res = await adminFetch(`/api/audits/${auditId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to generate report");
      }
      setSelectedAudit((prev) =>
        prev ? { ...prev, pdfReportUrl: json.data?.pdfReportUrl || `/api/audits/${auditId}/report` } : null
      );
      setAdminReportMessage({ type: "success", text: "PDF report generated successfully." });
      await handleAdminDownloadPdf(auditId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate PDF report";
      setAdminReportMessage({ type: "error", text: msg });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // --- Handlers: Trigger Notification Dispatch as Admin ---
  const handleAdminDispatchNotifications = async (auditId: string) => {
    setAdminReportMessage(null);
    try {
      const res = await adminFetch(`/api/audits/${auditId}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to dispatch notifications");
      }
      setAdminReportMessage({
        type: "success",
        text: `Notifications dispatched (${json.data?.length || 0} channel(s) processed).`,
      });
      fetchAuditNotifications(auditId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to dispatch notifications";
      setAdminReportMessage({ type: "error", text: msg });
    }
  };

  // --- Handlers: Fetch Users ---
  const fetchUsers = useCallback(
    async (page = 1, search = userSearch) => {
      if (!isAuthenticated) return;
      setUsersLoading(true);
      setUsersError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "10",
        });
        if (search.trim()) {
          params.set("search", search.trim());
        }

        const res = await adminFetch(`/api/admin/users?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          if (res.status === 401) {
            setIsAuthenticated(false);
            setAuthError("Session expired or invalid key. Please re-authenticate.");
            return;
          }
          throw new Error(json.message || "Failed to load users");
        }
        setUsers(json.data);
        setUsersPagination(json.pagination);
      } catch (err) {
        setUsersError(err instanceof Error ? err.message : "Error loading users");
      } finally {
        setUsersLoading(false);
      }
    },
    [adminFetch, isAuthenticated, userSearch]
  );

  // --- Handlers: Update User Role ---
  const handleToggleUserRole = async (user: UserRecordItem) => {
    const newRole = user.role === "ADMIN" ? "CLIENT" : "ADMIN";
    const promptMsg =
      newRole === "CLIENT"
        ? `Are you sure you want to demote ${user.email} from ADMIN to CLIENT?`
        : `Are you sure you want to promote ${user.email} to ADMIN?`;

    if (!confirm(promptMsg)) return;

    setUpdatingUserId(user.id);
    setUserRoleMessage(null);
    try {
      const res = await adminFetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, role: newRole }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to update user role");
      }
      setUserRoleMessage({ type: "success", text: `User ${user.email} role updated to ${newRole}.` });
      fetchUsers(usersPagination.page);
    } catch (err) {
      setUserRoleMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to update role" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  // --- Handlers: Fetch Queue Metrics ---
  const fetchQueue = useCallback(async () => {
    if (!isAuthenticated) return;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await adminFetch("/api/admin/queue");
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (res.status === 401) {
          setIsAuthenticated(false);
          setAuthError("Session expired or invalid key. Please re-authenticate.");
          return;
        }
        throw new Error(json.message || "Queue metrics unavailable");
      }
      setQueueData(json.data);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Error loading queue diagnostics");
    } finally {
      setQueueLoading(false);
    }
  }, [adminFetch, isAuthenticated]);

  // --- Handlers: Fetch Schedules as Admin ---
  const fetchAdminSchedules = useCallback(async () => {
    if (!isAuthenticated) return;
    setAdminSchedulesLoading(true);
    setAdminSchedulesError(null);
    try {
      const res = await adminFetch("/api/schedules");
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load schedules");
      }
      setAdminSchedules(json.data || []);
    } catch (err) {
      setAdminSchedulesError(err instanceof Error ? err.message : "Error loading schedules");
    } finally {
      setAdminSchedulesLoading(false);
    }
  }, [adminFetch, isAuthenticated]);

  const handleAdminTogglePauseSchedule = async (scheduleId: string, currentActive: boolean) => {
    try {
      const res = await adminFetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to toggle schedule");
      }
      fetchAdminSchedules();
    } catch (err) {
      setAdminSchedulesError(err instanceof Error ? err.message : "Error updating schedule");
    }
  };

  const handleAdminRunScheduleNow = async (scheduleId: string) => {
    setTriggeringScheduleId(scheduleId);
    try {
      const res = await adminFetch(`/api/schedules/${scheduleId}/run`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to run schedule");
      }
      fetchAdminSchedules();
    } catch (err) {
      setAdminSchedulesError(err instanceof Error ? err.message : "Error running schedule");
    } finally {
      setTriggeringScheduleId(null);
    }
  };

  // Tab change triggers appropriate fetch
  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === "overview") fetchOverview();
    if (activeTab === "audits") fetchAudits(1);
    if (activeTab === "users") fetchUsers(1);
    if (activeTab === "queue") fetchQueue();
    if (activeTab === "schedules") fetchAdminSchedules();
  }, [activeTab, isAuthenticated, fetchOverview, fetchAudits, fetchUsers, fetchQueue, fetchAdminSchedules]);

  // Status Badge Helper (Clean Light Theme)
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium">Completed</Badge>;
      case "FAILED":
        return <Badge className="bg-rose-50 text-rose-700 border-rose-200 font-medium">Failed</Badge>;
      case "QUEUED":
        return <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-medium">Queued</Badge>;
      case "CRAWLING":
        return <Badge className="bg-sky-50 text-sky-700 border-sky-200 font-medium">Crawling</Badge>;
      case "ANALYZING":
        return <Badge className="bg-purple-50 text-purple-700 border-purple-200 font-medium">Analyzing</Badge>;
      default:
        return <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">{status}</Badge>;
    }
  };

  // --- Login Screen (When Not Authenticated) ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col justify-center items-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purple-50 border border-purple-200 text-purple-600 mb-4 shadow-xs">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Admin Portal Access</h1>
            <p className="text-sm text-slate-600 mt-2">
              Edgelink Technology SEO Automation Operations
            </p>
          </div>

          <Card className="bg-white border-slate-200 shadow-xs rounded-2xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg font-bold text-slate-900">Administrator Verification</CardTitle>
              <CardDescription className="text-slate-600 text-xs leading-relaxed">
                Enter your administrative secret key. Authentication is validated strictly on the server before granting access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700">Admin Secret Key</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="Enter ADMIN_SECRET_KEY..."
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      className="pl-9 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-purple-600 shadow-2xs h-10"
                    />
                  </div>
                </div>

                {authError && (
                  <div className="flex items-center gap-2 p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl shadow-2xs">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{authError}</span>
                  </div>
                )}

                <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium h-10 shadow-xs transition">
                  Authenticate &amp; Access Dashboard
                </Button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-100 text-center">
                <Link href="/" className="inline-flex items-center text-xs text-slate-600 hover:text-slate-900 font-medium transition">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Return to Public Dashboard
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // --- Authenticated Admin Dashboard ---
  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 pb-20">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xs px-6 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium">
              <ArrowLeft className="h-4 w-4 mr-2" /> Home
            </Button>
          </Link>
          <div className="border-l border-slate-200 pl-4">
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span>Admin Operations Portal</span>
              <Badge className="bg-purple-50 text-purple-700 border-purple-200 font-medium text-xs">
                Live Server
              </Badge>
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full font-medium shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> Server-Verified Admin
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-medium"
          >
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign Out
          </Button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 pt-8 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Button
              variant={activeTab === "overview" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("overview")}
              className={activeTab === "overview" ? "bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-xs text-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-xs"}
            >
              <Activity className="w-4 h-4 mr-1.5 text-inherit" /> System Overview
            </Button>
            <Button
              variant={activeTab === "audits" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("audits")}
              className={activeTab === "audits" ? "bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-xs text-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-xs"}
            >
              <FileText className="w-4 h-4 mr-1.5 text-inherit" /> Audit Management
            </Button>
            <Button
              variant={activeTab === "users" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("users")}
              className={activeTab === "users" ? "bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-xs text-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-xs"}
            >
              <Users className="w-4 h-4 mr-1.5 text-inherit" /> User Management
            </Button>
            <Button
              variant={activeTab === "schedules" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("schedules")}
              className={activeTab === "schedules" ? "bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-xs text-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-xs"}
            >
              <Clock className="w-4 h-4 mr-1.5 text-inherit" /> Recurring Schedules
            </Button>
            <Button
              variant={activeTab === "queue" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("queue")}
              className={activeTab === "queue" ? "bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-xs text-xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium text-xs"}
            >
              <Server className="w-4 h-4 mr-1.5 text-inherit" /> Queue Diagnostics
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeTab === "overview") fetchOverview();
                if (activeTab === "audits") fetchAudits(auditsPagination.page);
                if (activeTab === "users") fetchUsers(usersPagination.page);
                if (activeTab === "queue") fetchQueue();
                if (activeTab === "schedules") fetchAdminSchedules();
              }}
              className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs shadow-2xs font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-slate-500" /> Refresh Data
            </Button>
          </div>
        </div>

        {/* Global Notifications */}
        {retryMessage && (
          <div
            className={`p-3.5 rounded-xl border text-sm flex items-center justify-between shadow-xs ${
              retryMessage.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            <div className="flex items-center gap-2">
              {retryMessage.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              )}
              <span className="font-medium text-xs">{retryMessage.text}</span>
            </div>
            <button onClick={() => setRetryMessage(null)} className="text-xs hover:underline font-semibold">
              Dismiss
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: SYSTEM OVERVIEW */}
        {/* ========================================================================= */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {overviewLoading && !overviewData && (
              <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                <p className="text-sm">Aggregating live PostgreSQL and Upstash Redis metrics...</p>
              </div>
            )}

            {overviewError && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-sm flex items-center justify-between shadow-xs">
                <span>{overviewError}</span>
                <Button size="sm" variant="outline" onClick={fetchOverview} className="border-rose-200 bg-white text-rose-800 hover:bg-rose-50">
                  Retry
                </Button>
              </div>
            )}

            {overviewData && (
              <>
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
                  <Card className="bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition rounded-xl">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Audits</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-2xl font-bold text-slate-900">{overviewData.totalAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Persisted in DB</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition rounded-xl">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Completed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-2xl font-bold text-emerald-600">{overviewData.completedAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Fully analyzed</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition rounded-xl">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Failed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-2xl font-bold text-rose-600">{overviewData.failedAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Eligible for retry</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition rounded-xl">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">In Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-2xl font-bold text-amber-600">
                        {overviewData.queuedAudits + overviewData.crawlingAudits + overviewData.analyzingAudits}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {overviewData.crawlingAudits} crawl · {overviewData.analyzingAudits} ai
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition rounded-xl">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Average Score</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-2xl font-bold text-purple-600 flex items-center gap-1">
                        {overviewData.averageScore !== null ? `${overviewData.averageScore}/100` : "N/A"}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Completed audits</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition rounded-xl">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Registered Users</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-2xl font-bold text-slate-800">{overviewData.totalUsers}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Active accounts</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Queue Health Card */}
                {overviewData.queue && (
                  <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base text-slate-900 font-bold flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-600" /> BullMQ &amp; Upstash Redis Diagnostics
                          </CardTitle>
                          <CardDescription className="text-slate-600 text-xs">
                            Active background worker queue: <span className="text-slate-900 font-mono font-medium">{overviewData.queue.queueName}</span>
                          </CardDescription>
                        </div>
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium">
                          {overviewData.queue.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                          <span className="text-xs font-semibold text-slate-600">Waiting</span>
                          <div className="text-xl font-bold text-slate-900 mt-1">{overviewData.queue.counts.waiting}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                          <span className="text-xs font-semibold text-slate-600">Active</span>
                          <div className="text-xl font-bold text-amber-600 mt-1">{overviewData.queue.counts.active}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                          <span className="text-xs font-semibold text-slate-600">Completed</span>
                          <div className="text-xl font-bold text-emerald-600 mt-1">{overviewData.queue.counts.completed}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                          <span className="text-xs font-semibold text-slate-600">Failed</span>
                          <div className="text-xl font-bold text-rose-600 mt-1">{overviewData.queue.counts.failed}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                          <span className="text-xs font-semibold text-slate-600">Delayed</span>
                          <div className="text-xl font-bold text-slate-600 mt-1">{overviewData.queue.counts.delayed}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Failures Card */}
                <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
                  <CardHeader>
                    <CardTitle className="text-base font-bold text-rose-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600" /> Recent Audit Failures &amp; Error Visibility
                    </CardTitle>
                    <CardDescription className="text-slate-500 text-xs">
                      Persisted audits in FAILED status. Inspect sanitized error causes or trigger safe retries.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {overviewData.recentFailures.length === 0 ? (
                      <div className="p-6 text-center text-slate-500 text-sm">
                        No failed audits currently detected in the database.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {overviewData.recentFailures.map((f) => (
                          <div
                            key={f.id}
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 gap-3 shadow-2xs"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-sm">{f.targetUrl}</span>
                                <span className="text-[11px] font-mono text-slate-400">ID: {f.id.slice(0, 8)}...</span>
                              </div>
                              <p className="text-xs text-rose-900 font-mono bg-white p-2 rounded-lg border border-rose-200">
                                {f.errorMessage || "Unknown error during crawl or analysis."}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                Failed at: {new Date(f.updatedAt).toLocaleString()}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={retryingAuditId === f.id}
                              onClick={() => handleRetryAudit(f.id)}
                              className="border-rose-300 text-rose-700 hover:bg-rose-100 bg-white text-xs shrink-0 shadow-2xs font-medium"
                            >
                              <RotateCcw className={`w-3.5 h-3.5 mr-1.5 ${retryingAuditId === f.id ? "animate-spin" : ""}`} />
                              Retry Audit
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: AUDIT MANAGEMENT */}
        {/* ========================================================================= */}
        {activeTab === "audits" && (
          <div className="space-y-4">
            {/* Filter and Search Controls */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search target URL..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchAudits(1, auditStatusFilter, auditSearch)}
                    className="pl-9 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 text-sm h-9 shadow-2xs"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchAudits(1, auditStatusFilter, auditSearch)}
                  className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 h-9 shadow-2xs font-medium"
                >
                  Search
                </Button>
              </div>

              {/* Status Filter Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                {["ALL", "QUEUED", "CRAWLING", "ANALYZING", "COMPLETED", "FAILED"].map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={auditStatusFilter === st ? "default" : "outline"}
                    onClick={() => {
                      setAuditStatusFilter(st);
                      fetchAudits(1, st, auditSearch);
                    }}
                    className={`h-8 text-xs font-medium ${
                      auditStatusFilter === st
                        ? "bg-purple-600 hover:bg-purple-700 text-white shadow-xs"
                        : "bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-2xs"
                    }`}
                  >
                    {st}
                  </Button>
                ))}
              </div>
            </div>

            {/* Audits Table */}
            <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
              <CardContent className="p-0">
                {auditsLoading ? (
                  <div className="p-12 text-center text-slate-500 flex items-center justify-center space-x-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-purple-600" />
                    <span>Loading audit records...</span>
                  </div>
                ) : auditsError ? (
                  <div className="p-8 text-center text-rose-600 space-y-2">
                    <p>{auditsError}</p>
                    <Button size="sm" variant="outline" onClick={() => fetchAudits(auditsPagination.page)} className="border-rose-200 bg-white text-rose-800 hover:bg-rose-50">
                      Retry
                    </Button>
                  </div>
                ) : audits.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    No audits match the current search or status criteria.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4">Audit ID</th>
                          <th className="py-3 px-4">Target URL</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Score</th>
                          <th className="py-3 px-4">Created</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {audits.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-4 font-mono text-slate-500">{a.id.slice(0, 8)}...</td>
                            <td className="py-3 px-4 font-semibold text-slate-900 max-w-xs truncate">{a.targetUrl}</td>
                            <td className="py-3 px-4">{renderStatusBadge(a.status)}</td>
                            <td className="py-3 px-4">
                              {a.score !== null ? (
                                <span className="font-bold text-purple-600 text-sm">{a.score}/100</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              {new Date(a.createdAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="py-3 px-4 text-right space-x-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedAudit(a);
                                  fetchAuditNotifications(a.id);
                                }}
                                className="h-7 text-xs border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-100 bg-white shadow-2xs font-medium"
                              >
                                <Eye className="w-3.5 h-3.5 mr-1 text-slate-500" /> View
                              </Button>
                              {a.status === "FAILED" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={retryingAuditId === a.id}
                                  onClick={() => handleRetryAudit(a.id)}
                                  className="h-7 text-xs border-rose-300 text-rose-700 hover:bg-rose-50 bg-white shadow-2xs font-medium"
                                >
                                  <RotateCcw className={`w-3 h-3 mr-1 ${retryingAuditId === a.id ? "animate-spin" : ""}`} />
                                  Retry
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>

              {/* Pagination Controls */}
              {auditsPagination.totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t border-slate-200 text-xs text-slate-600 bg-slate-50/50">
                  <div>
                    Page <span className="font-semibold text-slate-900">{auditsPagination.page}</span> of{" "}
                    <span className="font-semibold text-slate-900">{auditsPagination.totalPages}</span> ({auditsPagination.totalCount} total audits)
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={auditsPagination.page <= 1 || auditsLoading}
                      onClick={() => fetchAudits(auditsPagination.page - 1)}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 h-8 shadow-2xs"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={auditsPagination.page >= auditsPagination.totalPages || auditsLoading}
                      onClick={() => fetchAudits(auditsPagination.page + 1)}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 h-8 shadow-2xs"
                    >
                      Next <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: USER MANAGEMENT */}
        {/* ========================================================================= */}
        {activeTab === "users" && (
          <div className="space-y-4">
            {userRoleMessage && (
              <div
                className={`p-3.5 rounded-xl border text-sm flex items-center justify-between shadow-xs ${
                  userRoleMessage.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-rose-50 border-rose-200 text-rose-900"
                }`}
              >
                <span className="font-medium text-xs">{userRoleMessage.text}</span>
                <button onClick={() => setUserRoleMessage(null)} className="text-xs hover:underline font-semibold">
                  Dismiss
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-72">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by email or name..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchUsers(1, userSearch)}
                    className="pl-9 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 text-sm h-9 shadow-2xs"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => fetchUsers(1, userSearch)} className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 h-9 shadow-2xs font-medium">
                  Search
                </Button>
              </div>
            </div>

            <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
              <CardContent className="p-0">
                {usersLoading ? (
                  <div className="p-12 text-center text-slate-500 flex items-center justify-center space-x-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-purple-600" />
                    <span>Loading users from database...</span>
                  </div>
                ) : usersError ? (
                  <div className="p-8 text-center text-rose-600 space-y-2">
                    <p>{usersError}</p>
                    <Button size="sm" variant="outline" onClick={() => fetchUsers(usersPagination.page)} className="border-rose-200 bg-white text-rose-800 hover:bg-rose-50">
                      Retry
                    </Button>
                  </div>
                ) : users.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    No users found matching search query.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4">User</th>
                          <th className="py-3 px-4">Role</th>
                          <th className="py-3 px-4">Audits Created</th>
                          <th className="py-3 px-4">Joined Date</th>
                          <th className="py-3 px-4 text-right">Administrative Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {users.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900">{u.email}</div>
                              {u.name && <div className="text-[11px] text-slate-600">{u.name}</div>}
                              <div className="text-[10px] font-mono text-slate-400">ID: {u.id}</div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                className={
                                  u.role === "ADMIN"
                                    ? "bg-purple-50 text-purple-700 border-purple-200 font-medium"
                                    : "bg-slate-100 text-slate-700 border-slate-200 font-medium"
                                }
                              >
                                {u.role}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900">{u.auditCount}</td>
                            <td className="py-3 px-4 text-slate-600">
                              {new Date(u.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={updatingUserId === u.id}
                                onClick={() => handleToggleUserRole(u)}
                                className={`h-7 text-xs border-slate-200 bg-white font-medium shadow-2xs ${
                                  u.role === "ADMIN"
                                    ? "text-amber-700 hover:bg-amber-50"
                                    : "text-purple-700 hover:bg-purple-50"
                                }`}
                              >
                                {updatingUserId === u.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                                ) : (
                                  <UserCheck className="w-3 h-3 mr-1" />
                                )}
                                {u.role === "ADMIN" ? "Demote to CLIENT" : "Promote to ADMIN"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>

              {usersPagination.totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t border-slate-200 text-xs text-slate-600 bg-slate-50/50">
                  <div>
                    Page <span className="font-semibold text-slate-900">{usersPagination.page}</span> of{" "}
                    <span className="font-semibold text-slate-900">{usersPagination.totalPages}</span> ({usersPagination.totalCount} users)
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={usersPagination.page <= 1 || usersLoading}
                      onClick={() => fetchUsers(usersPagination.page - 1)}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 h-8 shadow-2xs"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={usersPagination.page >= usersPagination.totalPages || usersLoading}
                      onClick={() => fetchUsers(usersPagination.page + 1)}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 h-8 shadow-2xs"
                    >
                      Next <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: QUEUE DIAGNOSTICS */}
        {/* ========================================================================= */}
        {activeTab === "queue" && (
          <div className="space-y-6">
            {queueLoading && !queueData && (
              <div className="p-12 text-center text-slate-500 flex items-center justify-center space-x-2">
                <RefreshCw className="w-5 h-5 animate-spin text-purple-600" />
                <span>Querying Upstash Redis queue diagnostics...</span>
              </div>
            )}

            {queueError && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-sm flex items-center justify-between shadow-xs">
                <span>{queueError}</span>
                <Button size="sm" variant="outline" onClick={fetchQueue} className="border-rose-200 bg-white text-rose-800 hover:bg-rose-50">
                  Retry
                </Button>
              </div>
            )}

            {queueData && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Queue Name</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-lg font-mono font-bold text-slate-900">{queueData.queueName}</div>
                      <p className="text-[10px] text-slate-500 mt-1">BullMQ Worker Target</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Redis Connection Status</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-lg font-bold text-emerald-600 capitalize">{queueData.status}</div>
                      <p className="text-[10px] text-slate-500 mt-1">Upstash TLS Endpoint</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active / In-Flight</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-lg font-bold text-amber-600">{queueData.counts.active} Job(s)</div>
                      <p className="text-[10px] text-slate-500 mt-1">Currently handled by worker</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-white border-slate-200 shadow-xs rounded-xl">
                  <CardHeader>
                    <CardTitle className="text-base font-bold text-slate-900">BullMQ Job Status Counters</CardTitle>
                    <CardDescription className="text-slate-500 text-xs">
                      Live status counts returned by BullMQ Redis adapter
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                      <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                        <span className="text-xs font-semibold text-slate-600">Waiting in Queue</span>
                        <div className="text-2xl font-bold text-slate-900 mt-2">{queueData.counts.waiting}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                        <span className="text-xs font-semibold text-slate-600">Active Workers</span>
                        <div className="text-2xl font-bold text-amber-600 mt-2">{queueData.counts.active}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                        <span className="text-xs font-semibold text-slate-600">Completed Jobs</span>
                        <div className="text-2xl font-bold text-emerald-600 mt-2">{queueData.counts.completed}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                        <span className="text-xs font-semibold text-slate-600">Failed Jobs</span>
                        <div className="text-2xl font-bold text-rose-600 mt-2">{queueData.counts.failed}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 text-center shadow-2xs">
                        <span className="text-xs font-semibold text-slate-600">Delayed / Retrying</span>
                        <div className="text-2xl font-bold text-slate-600 mt-2">{queueData.counts.delayed}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: RECURRING SCHEDULES */}
        {/* ========================================================================= */}
        {activeTab === "schedules" && (
          <div className="space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-600" /> Platform-Wide Recurring Schedules
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Monitor and execute scheduled weekly and monthly audits configured by registered clients across the platform.
              </p>
            </div>

            {adminSchedulesError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900 text-xs flex items-center gap-2 shadow-xs">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{adminSchedulesError}</span>
              </div>
            )}

            <Card className="bg-white border-slate-200 shadow-xs rounded-xl overflow-hidden">
              <CardHeader className="p-4 border-b border-slate-100 bg-slate-50/60">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-900">Configured Automated Schedules</CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Total: {adminSchedules.length} schedule(s)
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={fetchAdminSchedules}
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs h-8 shadow-2xs font-medium"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1 text-slate-500" /> Refresh
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {adminSchedulesLoading ? (
                  <div className="p-12 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-purple-600" />
                    <div className="text-sm">Loading recurring schedules...</div>
                  </div>
                ) : adminSchedules.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    No active or configured recurring schedules found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4">Target Website</th>
                          <th className="py-3 px-4">User ID</th>
                          <th className="py-3 px-4">Frequency</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Next Run (UTC)</th>
                          <th className="py-3 px-4">Last Run</th>
                          <th className="py-3 px-4 text-right">Administrative Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {adminSchedules.map((schedule) => (
                          <tr key={schedule.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900 truncate max-w-xs">{schedule.targetUrl}</div>
                              {schedule.businessType && (
                                <div className="text-[11px] text-slate-500">{schedule.businessType}</div>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-500 truncate max-w-[120px]">
                              {schedule.userId}
                            </td>
                            <td className="py-3 px-4">
                              <Badge className={schedule.frequency === "WEEKLY" ? "bg-sky-50 text-sky-700 border-sky-200 text-[10px] font-medium" : "bg-purple-50 text-purple-700 border-purple-200 text-[10px] font-medium"}>
                                {schedule.frequency}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <Badge className={schedule.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium" : "bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-medium"}>
                                {schedule.isActive ? "Active" : "Paused"}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-slate-700 font-medium">
                              {new Date(schedule.nextRunAt).toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-slate-500">
                              {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : "Never"}
                            </td>
                            <td className="py-3 px-4 text-right space-x-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={triggeringScheduleId === schedule.id}
                                onClick={() => handleAdminRunScheduleNow(schedule.id)}
                                className="h-7 text-xs border-slate-200 bg-white text-purple-700 hover:bg-purple-50 shadow-2xs font-medium"
                              >
                                {triggeringScheduleId === schedule.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin mr-1 text-purple-600" />
                                ) : (
                                  <Zap className="w-3 h-3 mr-1 text-amber-500" />
                                )}
                                Run Now
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAdminTogglePauseSchedule(schedule.id, schedule.isActive)}
                                className="h-7 text-xs border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs font-medium"
                              >
                                {schedule.isActive ? "Pause" : "Resume"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* AUDIT DETAIL MODAL / DRAWER */}
      {/* ========================================================================= */}
      {selectedAudit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-base truncate max-w-md">{selectedAudit.targetUrl}</h3>
                  {renderStatusBadge(selectedAudit.status)}
                </div>
                <p className="text-xs font-mono text-slate-500 mt-1">Audit ID: {selectedAudit.id}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedAudit(null)}
                className="text-slate-400 hover:text-slate-700 font-semibold"
              >
                ✕
              </Button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Score Display */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs">
                <div>
                  <span className="text-xs text-slate-500 uppercase font-semibold">Overall SEO Score</span>
                  <div className="text-3xl font-extrabold text-purple-600 mt-1">
                    {selectedAudit.score !== null ? `${selectedAudit.score} / 100` : "Not Scored"}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500 space-y-1">
                  <div>Created: {new Date(selectedAudit.createdAt).toLocaleString()}</div>
                  <div>Updated: {new Date(selectedAudit.updatedAt).toLocaleString()}</div>
                </div>
              </div>

              {/* Phase 10: PDF Report Management */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold uppercase text-slate-700">PDF Audit Report</span>
                  </div>
                  <div>
                    {selectedAudit.status === "COMPLETED" ? (
                      selectedAudit.pdfReportUrl ? (
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-medium">Available</Badge>
                      ) : (
                        <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-medium">Ready to Generate</Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-slate-500 border-slate-200 bg-white">Unavailable ({selectedAudit.status})</Badge>
                    )}
                  </div>
                </div>

                {selectedAudit.status === "COMPLETED" && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleAdminDownloadPdf(selectedAudit.id)}
                      disabled={isDownloadingPdf || isGeneratingPdf}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center gap-1.5 shadow-xs font-medium"
                    >
                      {isDownloadingPdf ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Downloading...</span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-3.5 h-3.5" />
                          <span>Download PDF Report</span>
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAdminGeneratePdf(selectedAudit.id)}
                      disabled={isGeneratingPdf}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs flex items-center gap-1.5 shadow-2xs font-medium"
                    >
                      {isGeneratingPdf ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Rendering PDF...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Regenerate Report</span>
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {adminReportMessage && (
                  <div
                    className={`p-2.5 text-xs rounded-xl border shadow-2xs ${
                      adminReportMessage.type === "success"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                        : "bg-rose-50 border-rose-200 text-rose-900"
                    }`}
                  >
                    {adminReportMessage.text}
                  </div>
                )}
              </div>

              {/* Phase 10: Notification Deliveries History */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold uppercase text-slate-700">Notification Delivery Log</span>
                  </div>
                  {selectedAudit.status === "COMPLETED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAdminDispatchNotifications(selectedAudit.id)}
                      className="h-6 text-[11px] border-slate-200 bg-white text-blue-700 hover:bg-blue-50 shadow-2xs font-medium"
                    >
                      Dispatch Notifications
                    </Button>
                  )}
                </div>

                {notificationsLoading ? (
                  <div className="text-center py-3 text-slate-500 text-xs flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
                    <span>Loading delivery history...</span>
                  </div>
                ) : notificationsList.length === 0 ? (
                  <div className="text-slate-500 text-xs py-2">
                    No notification deliveries recorded for this audit yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notificationsList.map((notif: NotificationDeliveryItem) => (
                      <div key={notif.id} className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs flex items-center justify-between shadow-2xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">{notif.channel}</span>
                            <Badge
                              className={
                                notif.status === "SENT" || notif.status === "DELIVERED"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium"
                                  : notif.status === "FAILED"
                                  ? "bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-medium"
                                  : "bg-slate-100 text-slate-600 border-slate-200 text-[10px] font-medium"
                              }
                            >
                              {notif.status}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Recipient: <span className="font-mono text-slate-700">{notif.recipient}</span>
                          </div>
                          {notif.errorMessage && (
                            <div className="text-[10px] text-rose-700 font-mono mt-1">
                              Error: {notif.errorMessage}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-[10px] text-slate-500">
                          <div>{new Date(notif.createdAt).toLocaleTimeString()}</div>
                          <div>Attempts: {notif.attemptCount}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Error Message for Failed Audits */}
              {selectedAudit.status === "FAILED" && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-2 shadow-2xs">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                    <AlertTriangle className="w-4 h-4 text-rose-600" /> Failure Reason
                  </div>
                  <p className="text-xs text-rose-900 font-mono bg-white p-2.5 rounded-lg border border-rose-200">
                    {selectedAudit.errorMessage || "Processing terminated unexpectedly during crawler execution."}
                  </p>
                  <div className="pt-2">
                    <Button
                      size="sm"
                      disabled={retryingAuditId === selectedAudit.id}
                      onClick={() => handleRetryAudit(selectedAudit.id)}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs shadow-xs font-medium"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 mr-1.5 ${retryingAuditId === selectedAudit.id ? "animate-spin" : ""}`} />
                      Retry This Audit Now
                    </Button>
                  </div>
                </div>
              )}

              {/* AI Executive Summary */}
              {selectedAudit.aiAnalysisData?.executive_summary && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase text-slate-500">Executive Summary</h4>
                    {selectedAudit.aiAnalysisData?.audit_version?.includes("mock") ? (
                      <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-medium">
                        MOCK Claude (Offline Engine)
                      </Badge>
                    ) : (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium">
                        REAL Claude ({selectedAudit.aiAnalysisData?.audit_version || "Live API"})
                      </Badge>
                    )}
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed shadow-2xs">
                    {selectedAudit.aiAnalysisData.executive_summary}
                  </div>
                </div>
              )}

              {/* Score Breakdown */}
              {selectedAudit.aiAnalysisData?.score_breakdown && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-slate-500">Category Score Breakdown</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(selectedAudit.aiAnalysisData.score_breakdown).map(([category, val]) => (
                      <div key={category} className="p-3 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">{category.replace(/_/g, " ")}</span>
                        <div className="text-lg font-bold text-slate-900 mt-0.5">{val ?? "—"}/100</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Critical Issues */}
              {selectedAudit.aiAnalysisData?.critical_issues && selectedAudit.aiAnalysisData.critical_issues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-rose-700">Critical Issues Identified</h4>
                  <div className="space-y-2">
                    {selectedAudit.aiAnalysisData.critical_issues.map((iss, i) => (
                      <div key={i} className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 shadow-2xs">
                        <div className="font-bold">{iss.title || iss.issue || `Critical Issue #${i + 1}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Wins */}
              {selectedAudit.aiAnalysisData?.quick_wins && selectedAudit.aiAnalysisData.quick_wins.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-emerald-700">Quick Wins</h4>
                  <div className="space-y-2">
                    {selectedAudit.aiAnalysisData.quick_wins.map((qw, i) => (
                      <div key={i} className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 shadow-2xs">
                        <div className="font-bold">{qw.finding || qw.action || `Optimization #${i + 1}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setSelectedAudit(null)} className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs font-medium">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
