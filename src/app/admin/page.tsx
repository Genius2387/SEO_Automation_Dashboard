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

  // Status Badge Helper
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Completed</Badge>;
      case "FAILED":
        return <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">Failed</Badge>;
      case "QUEUED":
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Queued</Badge>;
      case "CRAWLING":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Crawling</Badge>;
      case "ANALYZING":
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Analyzing</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // --- Login Screen (When Not Authenticated) ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purple-950/60 border border-purple-500/40 text-purple-400 mb-4 shadow-lg shadow-purple-950/50">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Admin Portal Access</h1>
            <p className="text-sm text-slate-400 mt-2">
              Edgelink Technology SEO Automation Operations
            </p>
          </div>

          <Card className="bg-slate-900 border-slate-800 shadow-xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg text-white">Administrator Verification</CardTitle>
              <CardDescription className="text-slate-400 text-xs">
                Enter your administrative secret key. Authentication is validated strictly on the server before granting access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Admin Secret Key</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                    <Input
                      type="password"
                      placeholder="Enter ADMIN_SECRET_KEY..."
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      className="pl-9 bg-slate-950 border-slate-700 text-white placeholder:text-slate-600 focus:border-purple-500"
                    />
                  </div>
                </div>

                {authError && (
                  <div className="flex items-center gap-2 p-3 text-xs text-rose-300 bg-rose-950/50 border border-rose-800 rounded-md">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}

                <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium">
                  Authenticate &amp; Access Dashboard
                </Button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                <Link href="/" className="inline-flex items-center text-xs text-slate-400 hover:text-white transition">
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
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-2" /> Home
            </Button>
          </Link>
          <div className="border-l border-slate-800 pl-4">
            <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Admin Operations Portal</span>
              <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
                Live Server
              </Badge>
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800 px-3 py-1.5 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Server-Verified Admin
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 text-xs"
          >
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign Out
          </Button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 pt-8 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <Button
              variant={activeTab === "overview" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("overview")}
              className={activeTab === "overview" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Activity className="w-4 h-4 mr-1.5" /> System Overview
            </Button>
            <Button
              variant={activeTab === "audits" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("audits")}
              className={activeTab === "audits" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <FileText className="w-4 h-4 mr-1.5" /> Audit Management
            </Button>
            <Button
              variant={activeTab === "users" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("users")}
              className={activeTab === "users" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Users className="w-4 h-4 mr-1.5" /> User Management
            </Button>
            <Button
              variant={activeTab === "schedules" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("schedules")}
              className={activeTab === "schedules" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Clock className="w-4 h-4 mr-1.5" /> Recurring Schedules
            </Button>
            <Button
              variant={activeTab === "queue" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("queue")}
              className={activeTab === "queue" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Server className="w-4 h-4 mr-1.5" /> Queue Diagnostics
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
              className="border-slate-800 text-slate-300 hover:bg-slate-900 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh Data
            </Button>
          </div>
        </div>

        {/* Global Notifications */}
        {retryMessage && (
          <div
            className={`p-3 rounded-lg border text-sm flex items-center justify-between ${
              retryMessage.type === "success"
                ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                : "bg-rose-950/40 border-rose-800 text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {retryMessage.type === "success" ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              <span>{retryMessage.text}</span>
            </div>
            <button onClick={() => setRetryMessage(null)} className="text-xs hover:underline">
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
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                <p className="text-sm">Aggregating live PostgreSQL and Upstash Redis metrics...</p>
              </div>
            )}

            {overviewError && (
              <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-800 text-rose-300 text-sm flex items-center justify-between">
                <span>{overviewError}</span>
                <Button size="sm" variant="outline" onClick={fetchOverview}>
                  Retry
                </Button>
              </div>
            )}

            {overviewData && (
              <>
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Total Audits</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-white">{overviewData.totalAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Persisted in DB</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Completed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-emerald-400">{overviewData.completedAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Fully analyzed</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Failed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-rose-400">{overviewData.failedAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Eligible for retry</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">In Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-amber-400">
                        {overviewData.queuedAudits + overviewData.crawlingAudits + overviewData.analyzingAudits}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {overviewData.crawlingAudits} crawl · {overviewData.analyzingAudits} ai
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Average Score</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-cyan-400 flex items-center gap-1">
                        {overviewData.averageScore !== null ? `${overviewData.averageScore}/100` : "N/A"}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Completed audits</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Registered Users</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-purple-400">{overviewData.totalUsers}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Active accounts</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Queue Health Card */}
                {overviewData.queue && (
                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base text-white flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-400" /> BullMQ &amp; Upstash Redis Diagnostics
                          </CardTitle>
                          <CardDescription className="text-slate-400 text-xs">
                            Active background worker queue: <span className="text-slate-300 font-mono">{overviewData.queue.queueName}</span>
                          </CardDescription>
                        </div>
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                          {overviewData.queue.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center">
                          <span className="text-xs text-slate-400">Waiting</span>
                          <div className="text-xl font-bold text-white mt-1">{overviewData.queue.counts.waiting}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center">
                          <span className="text-xs text-slate-400">Active</span>
                          <div className="text-xl font-bold text-amber-400 mt-1">{overviewData.queue.counts.active}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center">
                          <span className="text-xs text-slate-400">Completed</span>
                          <div className="text-xl font-bold text-emerald-400 mt-1">{overviewData.queue.counts.completed}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center">
                          <span className="text-xs text-slate-400">Failed</span>
                          <div className="text-xl font-bold text-rose-400 mt-1">{overviewData.queue.counts.failed}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center">
                          <span className="text-xs text-slate-400">Delayed</span>
                          <div className="text-xl font-bold text-slate-400 mt-1">{overviewData.queue.counts.delayed}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Failures Card */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-base text-white flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400" /> Recent Audit Failures &amp; Error Visibility
                    </CardTitle>
                    <CardDescription className="text-slate-400 text-xs">
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
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-lg bg-slate-950 border border-slate-800 gap-3"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white text-sm">{f.targetUrl}</span>
                                <span className="text-[11px] font-mono text-slate-500">ID: {f.id.slice(0, 8)}...</span>
                              </div>
                              <p className="text-xs text-rose-400/90 font-mono">
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
                              className="border-rose-900/50 text-rose-300 hover:bg-rose-950/30 text-xs shrink-0"
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
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Search target URL..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchAudits(1, auditStatusFilter, auditSearch)}
                    className="pl-9 bg-slate-900 border-slate-800 text-sm h-9"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchAudits(1, auditStatusFilter, auditSearch)}
                  className="border-slate-800 h-9"
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
                    className={`h-8 text-xs ${
                      auditStatusFilter === st ? "bg-purple-600 text-white" : "border-slate-800 text-slate-400"
                    }`}
                  >
                    {st}
                  </Button>
                ))}
              </div>
            </div>

            {/* Audits Table */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-0">
                {auditsLoading ? (
                  <div className="p-12 text-center text-slate-400 flex items-center justify-center space-x-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
                    <span>Loading audit records...</span>
                  </div>
                ) : auditsError ? (
                  <div className="p-8 text-center text-rose-400 space-y-2">
                    <p>{auditsError}</p>
                    <Button size="sm" variant="outline" onClick={() => fetchAudits(auditsPagination.page)}>
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
                      <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="py-3 px-4">Audit ID</th>
                          <th className="py-3 px-4">Target URL</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Score</th>
                          <th className="py-3 px-4">Created</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {audits.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-3 px-4 font-mono text-slate-400">{a.id.slice(0, 8)}...</td>
                            <td className="py-3 px-4 font-medium text-white max-w-xs truncate">{a.targetUrl}</td>
                            <td className="py-3 px-4">{renderStatusBadge(a.status)}</td>
                            <td className="py-3 px-4">
                              {a.score !== null ? (
                                <span className="font-bold text-cyan-400">{a.score}/100</span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {new Date(a.createdAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="py-3 px-4 text-right space-x-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedAudit(a);
                                  fetchAuditNotifications(a.id);
                                }}
                                className="h-7 text-xs text-slate-300 hover:text-white"
                              >
                                <Eye className="w-3.5 h-3.5 mr-1" /> View
                              </Button>
                              {a.status === "FAILED" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={retryingAuditId === a.id}
                                  onClick={() => handleRetryAudit(a.id)}
                                  className="h-7 text-xs border-rose-900/60 text-rose-300 hover:bg-rose-950/40"
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
                <div className="flex items-center justify-between p-4 border-t border-slate-800 text-xs text-slate-400">
                  <div>
                    Page <span className="font-medium text-white">{auditsPagination.page}</span> of{" "}
                    <span className="font-medium text-white">{auditsPagination.totalPages}</span> ({auditsPagination.totalCount} total audits)
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={auditsPagination.page <= 1 || auditsLoading}
                      onClick={() => fetchAudits(auditsPagination.page - 1)}
                      className="border-slate-800 h-8"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={auditsPagination.page >= auditsPagination.totalPages || auditsLoading}
                      onClick={() => fetchAudits(auditsPagination.page + 1)}
                      className="border-slate-800 h-8"
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
                className={`p-3 rounded-lg border text-sm flex items-center justify-between ${
                  userRoleMessage.type === "success"
                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                    : "bg-rose-950/40 border-rose-800 text-rose-300"
                }`}
              >
                <span>{userRoleMessage.text}</span>
                <button onClick={() => setUserRoleMessage(null)} className="text-xs hover:underline">
                  Dismiss
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-72">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Search by email or name..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchUsers(1, userSearch)}
                    className="pl-9 bg-slate-900 border-slate-800 text-sm h-9"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => fetchUsers(1, userSearch)} className="border-slate-800 h-9">
                  Search
                </Button>
              </div>
            </div>

            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-0">
                {usersLoading ? (
                  <div className="p-12 text-center text-slate-400 flex items-center justify-center space-x-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
                    <span>Loading users from database...</span>
                  </div>
                ) : usersError ? (
                  <div className="p-8 text-center text-rose-400 space-y-2">
                    <p>{usersError}</p>
                    <Button size="sm" variant="outline" onClick={() => fetchUsers(usersPagination.page)}>
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
                      <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="py-3 px-4">User</th>
                          <th className="py-3 px-4">Role</th>
                          <th className="py-3 px-4">Audits Created</th>
                          <th className="py-3 px-4">Joined Date</th>
                          <th className="py-3 px-4 text-right">Administrative Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {users.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-3 px-4">
                              <div className="font-medium text-white">{u.email}</div>
                              {u.name && <div className="text-[11px] text-slate-500">{u.name}</div>}
                              <div className="text-[10px] font-mono text-slate-600">ID: {u.id}</div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                className={
                                  u.role === "ADMIN"
                                    ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                                    : "bg-slate-800 text-slate-300 border-slate-700"
                                }
                              >
                                {u.role}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-300">{u.auditCount}</td>
                            <td className="py-3 px-4 text-slate-400">
                              {new Date(u.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={updatingUserId === u.id}
                                onClick={() => handleToggleUserRole(u)}
                                className={`h-7 text-xs border-slate-700 ${
                                  u.role === "ADMIN"
                                    ? "text-amber-400 hover:bg-amber-950/30"
                                    : "text-purple-400 hover:bg-purple-950/30"
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
                <div className="flex items-center justify-between p-4 border-t border-slate-800 text-xs text-slate-400">
                  <div>
                    Page <span className="font-medium text-white">{usersPagination.page}</span> of{" "}
                    <span className="font-medium text-white">{usersPagination.totalPages}</span> ({usersPagination.totalCount} users)
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={usersPagination.page <= 1 || usersLoading}
                      onClick={() => fetchUsers(usersPagination.page - 1)}
                      className="border-slate-800 h-8"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={usersPagination.page >= usersPagination.totalPages || usersLoading}
                      onClick={() => fetchUsers(usersPagination.page + 1)}
                      className="border-slate-800 h-8"
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
              <div className="p-12 text-center text-slate-400 flex items-center justify-center space-x-2">
                <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
                <span>Querying Upstash Redis queue diagnostics...</span>
              </div>
            )}

            {queueError && (
              <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-800 text-rose-300 text-sm flex items-center justify-between">
                <span>{queueError}</span>
                <Button size="sm" variant="outline" onClick={fetchQueue}>
                  Retry
                </Button>
              </div>
            )}

            {queueData && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-medium text-slate-400">Queue Name</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-lg font-mono font-bold text-white">{queueData.queueName}</div>
                      <p className="text-[10px] text-slate-500 mt-1">BullMQ Worker Target</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-medium text-slate-400">Redis Connection Status</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-lg font-bold text-emerald-400 capitalize">{queueData.status}</div>
                      <p className="text-[10px] text-slate-500 mt-1">Upstash TLS Endpoint</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-medium text-slate-400">Active / In-Flight</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-lg font-bold text-amber-400">{queueData.counts.active} Job(s)</div>
                      <p className="text-[10px] text-slate-500 mt-1">Currently handled by worker</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-base text-white">BullMQ Job Status Counters</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">
                      Live status counts returned by BullMQ Redis adapter
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center">
                        <span className="text-xs text-slate-400">Waiting in Queue</span>
                        <div className="text-2xl font-bold text-white mt-2">{queueData.counts.waiting}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center">
                        <span className="text-xs text-slate-400">Active Workers</span>
                        <div className="text-2xl font-bold text-amber-400 mt-2">{queueData.counts.active}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center">
                        <span className="text-xs text-slate-400">Completed Jobs</span>
                        <div className="text-2xl font-bold text-emerald-400 mt-2">{queueData.counts.completed}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center">
                        <span className="text-xs text-slate-400">Failed Jobs</span>
                        <div className="text-2xl font-bold text-rose-400 mt-2">{queueData.counts.failed}</div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center">
                        <span className="text-xs text-slate-400">Delayed / Retrying</span>
                        <div className="text-2xl font-bold text-indigo-400 mt-2">{queueData.counts.delayed}</div>
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
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-400" /> Platform-Wide Recurring Schedules
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Monitor and execute scheduled weekly and monthly audits configured by registered clients across the platform.
              </p>
            </div>

            {adminSchedulesError && (
              <div className="rounded-xl border border-rose-500/50 bg-rose-950/30 p-4 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{adminSchedulesError}</span>
              </div>
            )}

            <Card className="bg-slate-900 border-slate-800 shadow-xl overflow-hidden">
              <CardHeader className="p-4 border-b border-slate-800 bg-slate-900/80">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-white">Configured Automated Schedules</CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Total: {adminSchedules.length} schedule(s)
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={fetchAdminSchedules}
                    className="border-slate-800 text-slate-300 text-xs h-8"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {adminSchedulesLoading ? (
                  <div className="p-12 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-purple-400" />
                    <div className="text-sm">Loading recurring schedules...</div>
                  </div>
                ) : adminSchedules.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    No active or configured recurring schedules found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
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
                      <tbody className="divide-y divide-slate-800/60">
                        {adminSchedules.map((schedule) => (
                          <tr key={schedule.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-3 px-4">
                              <div className="font-medium text-white truncate max-w-xs">{schedule.targetUrl}</div>
                              {schedule.businessType && (
                                <div className="text-[11px] text-slate-500">{schedule.businessType}</div>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-400 truncate max-w-[120px]">
                              {schedule.userId}
                            </td>
                            <td className="py-3 px-4">
                              <Badge className={schedule.frequency === "WEEKLY" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "bg-purple-500/20 text-purple-300 border-purple-500/30"}>
                                {schedule.frequency}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <Badge className={schedule.isActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}>
                                {schedule.isActive ? "Active" : "Paused"}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-slate-300">
                              {new Date(schedule.nextRunAt).toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : "Never"}
                            </td>
                            <td className="py-3 px-4 text-right space-x-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={triggeringScheduleId === schedule.id}
                                onClick={() => handleAdminRunScheduleNow(schedule.id)}
                                className="h-7 text-xs border-slate-700 text-purple-300 hover:bg-purple-950/30"
                              >
                                {triggeringScheduleId === schedule.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                                ) : (
                                  <Zap className="w-3 h-3 mr-1 text-amber-400" />
                                )}
                                Run Now
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAdminTogglePauseSchedule(schedule.id, schedule.isActive)}
                                className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white text-base truncate max-w-md">{selectedAudit.targetUrl}</h3>
                  {renderStatusBadge(selectedAudit.status)}
                </div>
                <p className="text-xs font-mono text-slate-500 mt-1">Audit ID: {selectedAudit.id}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedAudit(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </Button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Score Display */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div>
                  <span className="text-xs text-slate-400 uppercase font-semibold">Overall SEO Score</span>
                  <div className="text-3xl font-extrabold text-cyan-400 mt-1">
                    {selectedAudit.score !== null ? `${selectedAudit.score} / 100` : "Not Scored"}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400 space-y-1">
                  <div>Created: {new Date(selectedAudit.createdAt).toLocaleString()}</div>
                  <div>Updated: {new Date(selectedAudit.updatedAt).toLocaleString()}</div>
                </div>
              </div>

              {/* Phase 10: PDF Report Management */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-semibold uppercase text-slate-300">PDF Audit Report</span>
                  </div>
                  <div>
                    {selectedAudit.status === "COMPLETED" ? (
                      selectedAudit.pdfReportUrl ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Available</Badge>
                      ) : (
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Ready to Generate</Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-slate-500">Unavailable ({selectedAudit.status})</Badge>
                    )}
                  </div>
                </div>

                {selectedAudit.status === "COMPLETED" && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleAdminDownloadPdf(selectedAudit.id)}
                      disabled={isDownloadingPdf || isGeneratingPdf}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center gap-1.5"
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
                      className="border-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1.5"
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
                    className={`p-2.5 text-xs rounded-lg border ${
                      adminReportMessage.type === "success"
                        ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                        : "bg-rose-950/40 border-rose-800 text-rose-300"
                    }`}
                  >
                    {adminReportMessage.text}
                  </div>
                )}
              </div>

              {/* Phase 10: Notification Deliveries History */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold uppercase text-slate-300">Notification Delivery Log</span>
                  </div>
                  {selectedAudit.status === "COMPLETED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAdminDispatchNotifications(selectedAudit.id)}
                      className="h-6 text-[11px] border-slate-700 text-cyan-400 hover:text-white"
                    >
                      Dispatch Notifications
                    </Button>
                  )}
                </div>

                {notificationsLoading ? (
                  <div className="text-center py-3 text-slate-500 text-xs flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                    <span>Loading delivery history...</span>
                  </div>
                ) : notificationsList.length === 0 ? (
                  <div className="text-slate-500 text-xs py-2">
                    No notification deliveries recorded for this audit yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notificationsList.map((notif: NotificationDeliveryItem) => (
                      <div key={notif.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{notif.channel}</span>
                            <Badge
                              className={
                                notif.status === "SENT" || notif.status === "DELIVERED"
                                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]"
                                  : notif.status === "FAILED"
                                  ? "bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]"
                                  : "bg-slate-700/40 text-slate-400 text-[10px]"
                              }
                            >
                              {notif.status}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Recipient: <span className="font-mono text-slate-300">{notif.recipient}</span>
                          </div>
                          {notif.errorMessage && (
                            <div className="text-[10px] text-rose-400 font-mono mt-1">
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
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 space-y-2">
                  <div className="flex items-center gap-2 text-rose-300 font-semibold text-xs">
                    <AlertTriangle className="w-4 h-4" /> Failure Reason
                  </div>
                  <p className="text-xs text-rose-200/90 font-mono">
                    {selectedAudit.errorMessage || "Processing terminated unexpectedly during crawler execution."}
                  </p>
                  <div className="pt-2">
                    <Button
                      size="sm"
                      disabled={retryingAuditId === selectedAudit.id}
                      onClick={() => handleRetryAudit(selectedAudit.id)}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs"
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
                    <h4 className="text-xs font-semibold uppercase text-slate-400">Executive Summary</h4>
                    {selectedAudit.aiAnalysisData?.audit_version?.includes("mock") ? (
                      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                        MOCK Claude (Offline Engine)
                      </Badge>
                    ) : (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
                        REAL Claude ({selectedAudit.aiAnalysisData?.audit_version || "Live API"})
                      </Badge>
                    )}
                  </div>
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                    {selectedAudit.aiAnalysisData.executive_summary}
                  </div>
                </div>
              )}

              {/* Score Breakdown */}
              {selectedAudit.aiAnalysisData?.score_breakdown && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-slate-400">Category Score Breakdown</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(selectedAudit.aiAnalysisData.score_breakdown).map(([category, val]) => (
                      <div key={category} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-[10px] text-slate-500 uppercase">{category.replace(/_/g, " ")}</span>
                        <div className="text-lg font-bold text-white mt-0.5">{val ?? "—"}/100</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Critical Issues */}
              {selectedAudit.aiAnalysisData?.critical_issues && selectedAudit.aiAnalysisData.critical_issues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-rose-400">Critical Issues Identified</h4>
                  <div className="space-y-2">
                    {selectedAudit.aiAnalysisData.critical_issues.map((iss, i) => (
                      <div key={i} className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/50 text-xs text-rose-200">
                        <div className="font-semibold">{iss.title || iss.issue || `Critical Issue #${i + 1}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Wins */}
              {selectedAudit.aiAnalysisData?.quick_wins && selectedAudit.aiAnalysisData.quick_wins.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase text-emerald-400">Quick Wins</h4>
                  <div className="space-y-2">
                    {selectedAudit.aiAnalysisData.quick_wins.map((qw, i) => (
                      <div key={i} className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/50 text-xs text-emerald-200">
                        <div className="font-semibold">{qw.finding || qw.action || `Optimization #${i + 1}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setSelectedAudit(null)} className="border-slate-800">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
