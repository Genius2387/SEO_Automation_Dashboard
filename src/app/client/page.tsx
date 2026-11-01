"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Gauge,
  Activity,
  FileText,
  Clock,
  Layers,
  ChevronLeft,
  ChevronRight,
  User,
  Zap,
  Target,
  PlusCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// --- Types ---

interface ScoreBreakdown {
  technical: number;
  on_page: number;
  content: number;
  core_web_vitals: number;
  schema: number;
}

interface IssueItem {
  code?: string;
  title?: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
  category: string;
  description?: string;
  evidence?: string;
  recommendation?: string;
}

interface RecommendationItem {
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
  category: string;
  finding: string;
  fix: string;
  estimated_impact: "HIGH" | "MEDIUM" | "LOW" | string;
  effort: "LOW" | "MEDIUM" | "HIGH" | string;
  falsifiability_check?: string;
}

interface AuditRecordData {
  id: string;
  targetUrl: string;
  status: "PENDING" | "QUEUED" | "CRAWLING" | "ANALYZING" | "COMPLETED" | "FAILED";
  score: number | null;
  businessType?: string | null;
  city?: string | null;
  state?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  pdfReportUrl?: string | null;
  persisted?: boolean;
  storage?: string;
  aiAnalysisData?: {
    audit_version?: string;
    overall_score?: number;
    executive_summary?: string;
    score_breakdown?: ScoreBreakdown;
    critical_issues?: IssueItem[];
    important_issues?: IssueItem[];
    quick_wins?: RecommendationItem[];
    recommendations?: RecommendationItem[];
  } | null;
  rawCrawlData?: {
    title?: string;
    onPage?: {
      title?: { text?: string };
      metaDescription?: { text?: string };
    };
  } | null;
}

interface ClientOverviewMetrics {
  totalAudits: number;
  completedAudits: number;
  processingAudits: number;
  failedAudits: number;
  latestScore: number | null;
  averageScore: number | null;
  recentAudits: {
    id: string;
    targetUrl: string;
    status: string;
    score: number | null;
    createdAt: string;
    completedAt?: string | null;
  }[];
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// --- Types ---

interface ScheduledAuditItem {
  id: string;
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

export default function ClientDashboardPage() {
  // Navigation Tab State
  const [activeTab, setActiveTab] = useState<"overview" | "submit" | "history" | "results" | "schedules">("overview");

  // Verified User Authentication State
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name?: string | null; role: string } | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authName, setAuthName] = useState<string>("");
  const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Client Identity State (backward-compatibility)
  const [clientId, setClientId] = useState<string>("");
  const [clientIdInput, setClientIdInput] = useState<string>("");
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [showIdentityModal, setShowIdentityModal] = useState<boolean>(false);

  // Scheduled Audits State
  const [schedules, setSchedules] = useState<ScheduledAuditItem[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState<boolean>(false);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState<boolean>(false);
  const [scheduleUrl, setScheduleUrl] = useState<string>("https://example.com");
  const [scheduleFreq, setScheduleFreq] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [scheduleBusinessType, setScheduleBusinessType] = useState<string>("");
  const [scheduleCity, setScheduleCity] = useState<string>("");
  const [scheduleState, setScheduleState] = useState<string>("");
  const [triggeringScheduleId, setTriggeringScheduleId] = useState<string | null>(null);

  // Overview Tab State
  const [overview, setOverview] = useState<ClientOverviewMetrics | null>(null);
  const [overviewLoading, setOverviewLoading] = useState<boolean>(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Audit Submission Form State
  const [url, setUrl] = useState<string>("https://example.com");
  const [businessType, setBusinessType] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [stateRegion, setStateRegion] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // In-Flight Processing & Live Progress State
  const [activeAuditRecord, setActiveAuditRecord] = useState<AuditRecordData | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Detailed Audit Results View State
  const [selectedAudit, setSelectedAudit] = useState<AuditRecordData | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Audit History State
  const [historyAudits, setHistoryAudits] = useState<AuditRecordData[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("ALL");
  const [historySearch, setHistorySearch] = useState<string>("");
  const [historyPagination, setHistoryPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    totalCount: 0,
    totalPages: 1,
  });

  // Client Fetch Helper (attaches CSRF token and credentials: "include")
  const clientFetch = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      if (csrfToken) {
        headers.set("x-csrf-token", csrfToken);
      }
      if (clientId && !currentUser) {
        headers.set("x-user-id", clientId);
      }
      return fetch(endpoint, {
        ...options,
        headers,
        credentials: "include",
      });
    },
    [clientId, csrfToken, currentUser]
  );

  // PDF Report Download Handler
  const handleDownloadPdf = useCallback(
    async (auditId: string) => {
      setIsDownloadingPdf(true);
      setPdfError(null);
      try {
        const res = await clientFetch(`/api/audits/${auditId}/report`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to download report (HTTP ${res.status})`);
        }
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `edgelink-audit-${auditId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error downloading report PDF";
        setPdfError(msg);
      } finally {
        setIsDownloadingPdf(false);
      }
    },
    [clientFetch]
  );

  // PDF Report Generation Handler
  const handleGeneratePdf = useCallback(
    async (auditId: string) => {
      setIsGeneratingPdf(true);
      setPdfError(null);
      try {
        const res = await clientFetch(`/api/audits/${auditId}/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to generate report");
        }
        setSelectedAudit((prev) =>
          prev ? { ...prev, pdfReportUrl: json.data?.pdfReportUrl || `/api/audits/${auditId}/report` } : null
        );
        await handleDownloadPdf(auditId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to generate PDF report";
        setPdfError(msg);
      } finally {
        setIsGeneratingPdf(false);
      }
    },
    [clientFetch, handleDownloadPdf]
  );

  // Polling Cleanup Helper
  const clearActivePoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  // Poll Audit Status until Terminal State
  const startPollingAudit = useCallback(
    (auditId: string) => {
      clearActivePoll();
      setIsPolling(true);
      const pollStart = Date.now();

      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await clientFetch(`/api/audits/${auditId}`);
          if (!res.ok) {
            if (res.status === 404) {
              clearActivePoll();
              setSubmissionError(`Audit ${auditId} was not found on the server.`);
            }
            return;
          }

          const json = await res.json();
          if (json.success && json.data) {
            const rec = json.data as AuditRecordData;
            setActiveAuditRecord(rec);

            // Terminal status: COMPLETED
            if (rec.status === "COMPLETED") {
              clearActivePoll();
              setSelectedAudit(rec);
              setActiveTab("results");
              setIsSubmitting(false);
            }
            // Terminal status: FAILED
            else if (rec.status === "FAILED") {
              clearActivePoll();
              setSelectedAudit(rec);
              setIsSubmitting(false);
              setSubmissionError(rec.errorMessage || "Website analysis encountered an error.");
            }
          }
        } catch {
          // Suppress transient poll network fluctuations
        }

        // Maximum poll duration safety: 2 minutes
        if (Date.now() - pollStart > 120000) {
          clearActivePoll();
          setIsSubmitting(false);
        }
      }, 2000);
    },
    [clearActivePoll, clientFetch]
  );

  // --- Handlers: Overview Fetching ---
  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await clientFetch("/api/audits/overview");
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load overview metrics");
      }
      setOverview(json.data);
      if (json.meta?.email) {
        setClientEmail(json.meta.email);
      }
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : "Error loading dashboard metrics");
    } finally {
      setOverviewLoading(false);
    }
  }, [clientFetch]);

  // --- Handlers: Audit History Fetching ---
  const fetchHistory = useCallback(
    async (page = 1, status = historyStatusFilter, search = historySearch) => {
      setHistoryLoading(true);
      setHistoryError(null);
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

        const res = await clientFetch(`/api/audits?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to load audit history");
        }
        setHistoryAudits(json.data);
        setHistoryPagination(json.pagination);
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Error loading history");
      } finally {
        setHistoryLoading(false);
      }
    },
    [clientFetch, historySearch, historyStatusFilter]
  );

  // Load Saved Client Identity & Last Audit on Mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedClientId = sessionStorage.getItem("edgelink_client_user_id");
      if (savedClientId) {
        setClientId(savedClientId);
        setClientIdInput(savedClientId);
      }

      const savedAuditId = sessionStorage.getItem("edgelink_last_audit_id");
      if (savedAuditId) {
        // Recover state from database
        fetch(`/api/audits/${savedAuditId}`)
          .then((res) => res.json())
          .then((json) => {
            if (json.success && json.data) {
              const rec = json.data as AuditRecordData;
              setActiveAuditRecord(rec);
              if (rec.status === "COMPLETED") {
                setSelectedAudit(rec);
              } else if (["PENDING", "QUEUED", "CRAWLING", "ANALYZING"].includes(rec.status)) {
                startPollingAudit(rec.id);
              }
            }
          })
          .catch(() => {});
      }
    }

    return () => clearActivePoll();
  }, [clearActivePoll, startPollingAudit]);

  // Check Active Session on Mount
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const json = await res.json();
      if (json.authenticated && json.user) {
        setCurrentUser(json.user);
        setClientEmail(json.user.email);
        setClientId(json.user.id);
        if (json.csrfToken) {
          setCsrfToken(json.csrfToken);
        }
      } else {
        setCurrentUser(null);
      }
    } catch {
      // not logged in
    }
  }, []);

  // Fetch Recurring Schedules
  const fetchSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    setSchedulesError(null);
    try {
      const res = await clientFetch("/api/schedules");
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load schedules");
      }
      setSchedules(json.data || []);
    } catch (err) {
      setSchedulesError(err instanceof Error ? err.message : "Error loading schedules");
    } finally {
      setSchedulesLoading(false);
    }
  }, [clientFetch]);

  // Auth Handlers: Login, Register, Logout
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword || authSubmitting) return;
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Login failed");
      }
      setCurrentUser(json.user);
      setClientEmail(json.user.email);
      setClientId(json.user.id);
      setShowIdentityModal(false);
      setAuthPassword("");
      await checkSession();
      fetchOverview();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword || authSubmitting) return;
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: authEmail, password: authPassword, name: authName }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Registration failed");
      }
      setCurrentUser(json.user);
      setClientEmail(json.user.email);
      setClientId(json.user.id);
      setShowIdentityModal(false);
      setAuthPassword("");
      await checkSession();
      fetchOverview();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      setCurrentUser(null);
      setClientEmail(null);
      setClientId("");
      setCsrfToken(null);
      setShowIdentityModal(false);
      fetchOverview();
    } catch {
      // ignore
    }
  };

  // Schedule Handlers: Create, Pause, Resume, Delete, Run Now
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleUrl.trim() || isCreatingSchedule) return;
    setIsCreatingSchedule(true);
    setSchedulesError(null);
    try {
      const res = await clientFetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: scheduleUrl.trim(),
          frequency: scheduleFreq,
          businessType: scheduleBusinessType.trim() || undefined,
          city: scheduleCity.trim() || undefined,
          state: scheduleState.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to create schedule");
      }
      setScheduleUrl("https://example.com");
      await fetchSchedules();
    } catch (err) {
      setSchedulesError(err instanceof Error ? err.message : "Error creating schedule");
    } finally {
      setIsCreatingSchedule(false);
    }
  };

  const handleTogglePauseSchedule = async (scheduleId: string, currentActive: boolean) => {
    try {
      const res = await clientFetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to toggle schedule");
      }
      await fetchSchedules();
    } catch (err) {
      setSchedulesError(err instanceof Error ? err.message : "Error updating schedule");
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm("Are you sure you want to cancel and delete this recurring schedule?")) return;
    try {
      const res = await clientFetch(`/api/schedules/${scheduleId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to delete schedule");
      }
      await fetchSchedules();
    } catch (err) {
      setSchedulesError(err instanceof Error ? err.message : "Error deleting schedule");
    }
  };

  const handleRunScheduleNow = async (scheduleId: string) => {
    setTriggeringScheduleId(scheduleId);
    try {
      const res = await clientFetch(`/api/schedules/${scheduleId}/run`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to run schedule");
      }
      await fetchSchedules();
      if (json.data?.auditId) {
        sessionStorage.setItem("edgelink_last_audit_id", json.data.auditId);
        startPollingAudit(json.data.auditId);
      }
    } catch (err) {
      setSchedulesError(err instanceof Error ? err.message : "Error running schedule");
    } finally {
      setTriggeringScheduleId(null);
    }
  };

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Tab Change Triggers Data Load
  useEffect(() => {
    if (activeTab === "overview") fetchOverview();
    if (activeTab === "history") fetchHistory(1);
    if (activeTab === "schedules") fetchSchedules();
  }, [activeTab, fetchOverview, fetchHistory, fetchSchedules]);

  // When Client Identity Changes, Reload Data
  useEffect(() => {
    fetchOverview();
    if (activeTab === "history") fetchHistory(1);
    if (activeTab === "schedules") fetchSchedules();
  }, [clientId, fetchOverview, fetchHistory, fetchSchedules, activeTab]);

  // --- Handlers: Submit New Audit ---
  const handleRunAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isSubmitting) return;

    // Client-side convenience validation
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setSubmissionError("Please enter a valid website URL starting with http:// or https://");
        return;
      }
      if (parsed.username || parsed.password) {
        setSubmissionError("Website URLs containing embedded credentials are not permitted.");
        return;
      }
    } catch {
      setSubmissionError("Please enter a syntactically valid website URL (e.g., https://example.com).");
      return;
    }

    clearActivePoll();
    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const payload: Record<string, unknown> = {
        targetUrl: url.trim(),
      };
      if (businessType.trim()) payload.businessType = businessType.trim();
      if (city.trim()) payload.city = city.trim();
      if (stateRegion.trim()) payload.state = stateRegion.trim();

      const res = await clientFetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setSubmissionError(json.message || json.error || "Failed to submit audit.");
        setIsSubmitting(false);
        return;
      }

      const auditId = json.data.id;
      setActiveAuditRecord(json.data);

      if (typeof window !== "undefined") {
        sessionStorage.setItem("edgelink_last_audit_id", auditId);
      }

      // If completed synchronously
      if (json.data.status === "COMPLETED") {
        setSelectedAudit(json.data);
        setActiveTab("results");
        setIsSubmitting(false);
        return;
      }

      // Begin polling queued audit
      startPollingAudit(auditId);
    } catch (err) {
      setSubmissionError(err instanceof Error ? err.message : "Network error triggering audit.");
      setIsSubmitting(false);
    }
  };

  // --- Handlers: Client Identity Configuration ---
  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = clientIdInput.trim();
    setClientId(cleanId);
    if (typeof window !== "undefined") {
      if (cleanId) {
        sessionStorage.setItem("edgelink_client_user_id", cleanId);
      } else {
        sessionStorage.removeItem("edgelink_client_user_id");
        setClientEmail(null);
      }
    }
    setShowIdentityModal(false);
  };

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
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Crawling Site</Badge>;
      case "ANALYZING":
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Evaluating AI</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

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
              <span>Client SEO Dashboard</span>
              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
                Active Session
              </Badge>
            </h1>
          </div>
        </div>

        {/* User Identity Indicator */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowIdentityModal(true)}
            className="flex items-center text-xs text-slate-300 bg-slate-900 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-full transition"
          >
            <User className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
            <span>
              {clientEmail ? (
                <span>Client: <strong className="text-white">{clientEmail}</strong></span>
              ) : clientId ? (
                <span>ID: <code className="text-white font-mono">{clientId.slice(0, 8)}...</code></span>
              ) : (
                <span className="text-slate-400">Anonymous Mode (Click to Sign In)</span>
              )}
            </span>
          </button>
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
              className={activeTab === "overview" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Activity className="w-4 h-4 mr-1.5" /> Dashboard Overview
            </Button>
            <Button
              variant={activeTab === "submit" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("submit")}
              className={activeTab === "submit" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <PlusCircle className="w-4 h-4 mr-1.5" /> Run New Audit
            </Button>
            <Button
              variant={activeTab === "schedules" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("schedules")}
              className={activeTab === "schedules" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Clock className="w-4 h-4 mr-1.5" /> Scheduled Audits
            </Button>
            <Button
              variant={activeTab === "history" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("history")}
              className={activeTab === "history" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <Layers className="w-4 h-4 mr-1.5" /> Audit History
            </Button>
            <Button
              variant={activeTab === "results" ? "default" : "ghost"}
              size="sm"
              disabled={!selectedAudit}
              onClick={() => setActiveTab("results")}
              className={activeTab === "results" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}
            >
              <FileText className="w-4 h-4 mr-1.5" /> Detailed Results {selectedAudit && `(${selectedAudit.score ?? "—"}/100)`}
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeTab === "overview") fetchOverview();
                if (activeTab === "history") fetchHistory(historyPagination.page);
                if (activeTab === "schedules") fetchSchedules();
              }}
              className="border-slate-800 text-slate-300 hover:bg-slate-900 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Global Submission / Notice Alert */}
        {submissionError && (
          <div className="rounded-xl border border-rose-500/50 bg-rose-950/30 p-4 text-rose-300 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-rose-200">Audit Notice</div>
                <div className="text-sm mt-0.5">{submissionError}</div>
              </div>
            </div>
            <button onClick={() => setSubmissionError(null)} className="text-xs hover:underline text-rose-400">
              Dismiss
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: DASHBOARD OVERVIEW */}
        {/* ========================================================================= */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {overviewLoading && !overview && (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
                <p className="text-sm">Loading your personal SEO audit statistics...</p>
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

            {overview && (
              <>
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Total Audits</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-white">{overview.totalAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Submitted by you</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Completed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-emerald-400">{overview.completedAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Scored &amp; analyzed</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Processing</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-amber-400">{overview.processingAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">In queue or crawl</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Failed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-rose-400">{overview.failedAudits}</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Crawl or network issue</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Latest Score</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-cyan-400">
                        {overview.latestScore !== null ? `${overview.latestScore}/100` : "—"}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Most recent audit</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-medium text-slate-400">Average Score</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="text-2xl font-bold text-blue-400">
                        {overview.averageScore !== null ? `${overview.averageScore}/100` : "—"}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">All completed</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Quick Action & Recent Audits Card */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Quick Action Prompt */}
                  <Card className="bg-slate-900 border-slate-800 flex flex-col justify-between">
                    <CardHeader>
                      <CardTitle className="text-base text-white flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" /> Need an instant SEO assessment?
                      </CardTitle>
                      <CardDescription className="text-slate-400 text-xs">
                        Our engine evaluates on-page HTML signals, robots.txt, Core Web Vitals, Schema markup, and Claude AI findings.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Audits run asynchronously through our fault-tolerant BullMQ pipeline and persist directly to PostgreSQL.
                      </p>
                      <Button
                        onClick={() => setActiveTab("submit")}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm"
                      >
                        <PlusCircle className="w-4 h-4 mr-2" /> Start New Audit
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Recent Activity List */}
                  <Card className="bg-slate-900 border-slate-800 lg:col-span-2">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-blue-400" /> Recent Audit Activity
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveTab("history")}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          View All Audits
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {overview.recentAudits.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-sm">
                          You haven&apos;t run any audits yet. Click <strong>Start New Audit</strong> to analyze your first website.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-800/60">
                          {overview.recentAudits.map((a) => (
                            <div key={a.id} className="py-3 flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <div className="font-medium text-white text-sm truncate">{a.targetUrl}</div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  {new Date(a.createdAt).toLocaleString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                {renderStatusBadge(a.status)}
                                <div className="text-right">
                                  {a.score !== null ? (
                                    <span className="font-bold text-cyan-400 text-sm">{a.score}/100</span>
                                  ) : (
                                    <span className="text-slate-500 text-xs">—</span>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    const res = await clientFetch(`/api/audits/${a.id}`);
                                    const json = await res.json();
                                    if (json.success && json.data) {
                                      setSelectedAudit(json.data);
                                      setActiveTab("results");
                                    }
                                  }}
                                  className="h-7 text-xs text-slate-400 hover:text-white"
                                >
                                  View
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: SUBMIT NEW AUDIT */}
        {/* ========================================================================= */}
        {activeTab === "submit" && (
          <div className="max-w-3xl mx-auto space-y-6">
            <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-xl">
              <CardHeader>
                <CardTitle className="text-xl text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-400" /> Start a New SEO Website Audit
                </CardTitle>
                <CardDescription className="text-slate-400 text-xs">
                  Enter your target website URL. Our engine validates HTTP/HTTPS protocols, safeguards against SSRF, extracts on-page technical signals, and generates evidence-based Claude AI recommendations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRunAudit} className="space-y-4">
                  {/* Target URL */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      Target Website URL <span className="text-rose-400">*</span>
                    </label>
                    <Input
                      type="url"
                      required
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com"
                      disabled={isSubmitting}
                      className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-500 focus-visible:ring-blue-500 h-10"
                    />
                  </div>

                  {/* Optional Metadata Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Business Type (Optional)</label>
                      <Input
                        type="text"
                        value={businessType}
                        onChange={(e) => setBusinessType(e.target.value)}
                        placeholder="e.g. Dental Clinic"
                        disabled={isSubmitting}
                        className="bg-slate-950 border-slate-800 text-xs h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">City (Optional)</label>
                      <Input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Pune"
                        disabled={isSubmitting}
                        className="bg-slate-950 border-slate-800 text-xs h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">State (Optional)</label>
                      <Input
                        type="text"
                        value={stateRegion}
                        onChange={(e) => setStateRegion(e.target.value)}
                        placeholder="e.g. Maharashtra"
                        disabled={isSubmitting}
                        className="bg-slate-950 border-slate-800 text-xs h-9"
                      />
                    </div>
                  </div>

                  <div className="pt-3">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-10 gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" /> Enqueueing Audit Request...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4" /> Enqueue &amp; Run Audit
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* In-Flight Live Progress Tracker */}
            {(isPolling || (activeAuditRecord && ["PENDING", "QUEUED", "CRAWLING", "ANALYZING"].includes(activeAuditRecord.status))) && (
              <Card className="bg-slate-900 border-blue-900/40 text-slate-100 shadow-lg animate-pulse">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-blue-300 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-400" /> Audit in Progress
                    </CardTitle>
                    {activeAuditRecord && renderStatusBadge(activeAuditRecord.status)}
                  </div>
                  <CardDescription className="text-xs text-slate-400">
                    Target: <span className="text-white font-medium">{activeAuditRecord?.targetUrl || url}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Pipeline Step Indicators */}
                  <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                    <div className="p-2 rounded bg-slate-950 border border-slate-800">
                      <div className="font-semibold text-emerald-400">1. Queued</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">Enqueued in BullMQ</div>
                    </div>
                    <div
                      className={`p-2 rounded border ${
                        activeAuditRecord?.status === "CRAWLING" || activeAuditRecord?.status === "ANALYZING"
                          ? "bg-blue-950/40 border-blue-800 text-blue-300 font-bold"
                          : "bg-slate-950 border-slate-800 text-slate-500"
                      }`}
                    >
                      <div>2. Crawling</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">SSRF &amp; Cheerio</div>
                    </div>
                    <div
                      className={`p-2 rounded border ${
                        activeAuditRecord?.status === "ANALYZING"
                          ? "bg-purple-950/40 border-purple-800 text-purple-300 font-bold"
                          : "bg-slate-950 border-slate-800 text-slate-500"
                      }`}
                    >
                      <div>3. AI Analysis</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">Claude Scoring</div>
                    </div>
                    <div className="p-2 rounded bg-slate-950 border border-slate-800 text-slate-500">
                      <div>4. Results</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">PostgreSQL</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 text-center">
                    Audits typically finish within 3 to 10 seconds. You may safely stay on this page or refresh; status is automatically tracked.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: AUDIT HISTORY */}
        {/* ========================================================================= */}
        {activeTab === "history" && (
          <div className="space-y-4">
            {/* Filter and Search Controls */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Search by target website URL..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchHistory(1, historyStatusFilter, historySearch)}
                    className="pl-9 bg-slate-900 border-slate-800 text-sm h-9"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchHistory(1, historyStatusFilter, historySearch)}
                  className="border-slate-800 h-9"
                >
                  Search
                </Button>
              </div>

              {/* Status Filter Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                {["ALL", "COMPLETED", "QUEUED", "CRAWLING", "ANALYZING", "FAILED"].map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={historyStatusFilter === st ? "default" : "outline"}
                    onClick={() => {
                      setHistoryStatusFilter(st);
                      fetchHistory(1, st, historySearch);
                    }}
                    className={`h-8 text-xs ${
                      historyStatusFilter === st ? "bg-blue-600 text-white" : "border-slate-800 text-slate-400"
                    }`}
                  >
                    {st}
                  </Button>
                ))}
              </div>
            </div>

            {/* History Table */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-0">
                {historyLoading ? (
                  <div className="p-12 text-center text-slate-400 flex items-center justify-center space-x-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                    <span>Loading your audit history...</span>
                  </div>
                ) : historyError ? (
                  <div className="p-8 text-center text-rose-400 space-y-2">
                    <p>{historyError}</p>
                    <Button size="sm" variant="outline" onClick={() => fetchHistory(historyPagination.page)}>
                      Retry
                    </Button>
                  </div>
                ) : historyAudits.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 space-y-3">
                    <Layers className="w-8 h-8 mx-auto text-slate-600" />
                    <div>No audits match the current search or status filter.</div>
                    <Button size="sm" onClick={() => setActiveTab("submit")} className="bg-blue-600 hover:bg-blue-500 text-white text-xs">
                      Run Your First Audit
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="py-3 px-4">Target Website</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">SEO Score</th>
                          <th className="py-3 px-4">Submitted</th>
                          <th className="py-3 px-4">Completed</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {historyAudits.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-3 px-4 font-medium text-white max-w-xs truncate">
                              <div>{a.targetUrl}</div>
                              <div className="text-[10px] font-mono text-slate-500">ID: {a.id.slice(0, 8)}...</div>
                            </td>
                            <td className="py-3 px-4">{renderStatusBadge(a.status)}</td>
                            <td className="py-3 px-4">
                              {a.score !== null ? (
                                <span className="font-bold text-cyan-400 text-sm">{a.score}/100</span>
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
                            <td className="py-3 px-4 text-slate-400">
                              {a.completedAt ? (
                                new Date(a.completedAt).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              ) : a.status === "FAILED" ? (
                                <span className="text-rose-400">Terminated</span>
                              ) : (
                                <span className="text-slate-500">In Progress</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  const res = await clientFetch(`/api/audits/${a.id}`);
                                  const json = await res.json();
                                  if (json.success && json.data) {
                                    setSelectedAudit(json.data);
                                    setActiveTab("results");
                                  }
                                }}
                                className="h-7 text-xs border-slate-700 text-blue-400 hover:text-white hover:bg-blue-950/40"
                              >
                                View Results
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>

              {/* Pagination Controls */}
              {historyPagination.totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t border-slate-800 text-xs text-slate-400">
                  <div>
                    Page <span className="font-medium text-white">{historyPagination.page}</span> of{" "}
                    <span className="font-medium text-white">{historyPagination.totalPages}</span> ({historyPagination.totalCount} audits)
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={historyPagination.page <= 1 || historyLoading}
                      onClick={() => fetchHistory(historyPagination.page - 1)}
                      className="border-slate-800 h-8"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={historyPagination.page >= historyPagination.totalPages || historyLoading}
                      onClick={() => fetchHistory(historyPagination.page + 1)}
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
        {/* TAB 4: DETAILED AUDIT RESULTS */}
        {/* ========================================================================= */}
        {activeTab === "results" && selectedAudit && (
          <div className="space-y-6">
            {/* Status & Header Card */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white truncate max-w-xl">{selectedAudit.targetUrl}</h2>
                  {renderStatusBadge(selectedAudit.status)}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>ID: <code className="text-slate-300 font-mono">{selectedAudit.id}</code></span>
                  <span>Submitted: {new Date(selectedAudit.createdAt).toLocaleString()}</span>
                  {selectedAudit.completedAt && (
                    <span>Completed: {new Date(selectedAudit.completedAt).toLocaleString()}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedAudit.status === "COMPLETED" && (
                  <>
                    {selectedAudit.pdfReportUrl ? (
                      <Button
                        id="download-pdf-button"
                        size="sm"
                        onClick={() => handleDownloadPdf(selectedAudit.id)}
                        disabled={isDownloadingPdf || isGeneratingPdf}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center gap-1.5 shadow-sm"
                      >
                        {isDownloadingPdf ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Downloading PDF...</span>
                          </>
                        ) : (
                          <>
                            <FileText className="w-3.5 h-3.5" />
                            <span>Download PDF Report</span>
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        id="generate-pdf-button"
                        size="sm"
                        onClick={() => handleGeneratePdf(selectedAudit.id)}
                        disabled={isGeneratingPdf}
                        className="bg-sky-600 hover:bg-sky-500 text-white text-xs flex items-center gap-1.5 shadow-sm"
                      >
                        {isGeneratingPdf ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Generating PDF...</span>
                          </>
                        ) : (
                          <>
                            <FileText className="w-3.5 h-3.5" />
                            <span>Generate PDF Report</span>
                          </>
                        )}
                      </Button>
                    )}
                  </>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setUrl(selectedAudit.targetUrl);
                    setActiveTab("submit");
                  }}
                  className="border-slate-800 text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-audit Domain
                </Button>
              </div>
            </div>

            {/* PDF Generation Error Banner */}
            {pdfError && (
              <div className="p-3 text-xs bg-rose-950/40 border border-rose-800 text-rose-300 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{pdfError}</span>
                </div>
                <button onClick={() => setPdfError(null)} className="text-rose-400 hover:text-white font-bold ml-2">
                  ✕
                </button>
              </div>
            )}

            {/* If audit is FAILED */}
            {selectedAudit.status === "FAILED" && (
              <Card className="bg-rose-950/30 border-rose-800 text-slate-100">
                <CardHeader>
                  <CardTitle className="text-base text-rose-300 flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-rose-400" /> Audit Could Not Be Completed
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-rose-200/90 leading-relaxed font-mono bg-rose-950/60 p-3 rounded-lg border border-rose-900/60">
                    {selectedAudit.errorMessage || "The target website could not be crawled or analyzed. Please ensure the domain is publicly reachable."}
                  </p>
                  <p className="text-xs text-slate-400">
                    You can try submitting the website again or verify that DNS resolution and SSL certificates are valid.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setUrl(selectedAudit.targetUrl);
                      setActiveTab("submit");
                    }}
                    className="bg-rose-600 hover:bg-rose-500 text-white text-xs"
                  >
                    Try Auditing Again
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Score & AI Executive Summary */}
            {selectedAudit.status === "COMPLETED" && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Overall Score Card */}
                  <Card className="bg-slate-900 border-slate-800 text-slate-100 flex flex-col justify-center items-center p-6 text-center">
                    <div className="text-5xl font-extrabold text-blue-400 tracking-tight">
                      {selectedAudit.score ?? 0}<span className="text-2xl text-slate-500">/100</span>
                    </div>
                    <div className="text-sm font-semibold text-white mt-2">Overall SEO Health Score</div>
                    <p className="text-[11px] text-slate-500 mt-2 max-w-xs leading-normal">
                      Calculated assessment based on weighted technical, on-page, content, Core Web Vitals, and Schema evaluations.
                    </p>
                  </Card>

                  {/* Executive AI Summary Card */}
                  <Card className="bg-slate-900 border-slate-800 text-slate-100 md:col-span-2">
                    <CardHeader>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-base text-white flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-indigo-400" /> Executive AI Summary
                        </CardTitle>
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
                      <CardDescription className="text-slate-400 text-xs">
                        {selectedAudit.aiAnalysisData?.audit_version?.includes("mock")
                          ? "Generated via deterministic mock AI engine (zero Anthropic API credits consumed)"
                          : "Synthesized by Anthropic Claude AI analysis engine from live crawl evidence"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-slate-300 leading-relaxed text-xs sm:text-sm">
                        {selectedAudit.aiAnalysisData?.executive_summary || "Audit analysis complete."}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* 5 Category Score Cards */}
                {selectedAudit.aiAnalysisData?.score_breakdown && (
                  <Card className="bg-slate-900 border-slate-800 text-slate-100">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base text-white flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-cyan-400" /> Weighted Category Health Breakdown
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                          <div className="text-xs text-slate-400">Technical SEO</div>
                          <div className="text-xl font-bold text-white mt-1">
                            {selectedAudit.aiAnalysisData.score_breakdown.technical}/100
                          </div>
                          <span className="text-[10px] text-slate-500">Weight: 25%</span>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                          <div className="text-xs text-slate-400">On-Page SEO</div>
                          <div className="text-xl font-bold text-white mt-1">
                            {selectedAudit.aiAnalysisData.score_breakdown.on_page}/100
                          </div>
                          <span className="text-[10px] text-slate-500">Weight: 25%</span>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                          <div className="text-xs text-slate-400">Content Quality</div>
                          <div className="text-xl font-bold text-white mt-1">
                            {selectedAudit.aiAnalysisData.score_breakdown.content}/100
                          </div>
                          <span className="text-[10px] text-slate-500">Weight: 20%</span>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                          <div className="text-xs text-slate-400">Core Web Vitals</div>
                          <div className="text-xl font-bold text-white mt-1">
                            {selectedAudit.aiAnalysisData.score_breakdown.core_web_vitals}/100
                          </div>
                          <span className="text-[10px] text-slate-500">Weight: 15%</span>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                          <div className="text-xs text-slate-400">Schema Markup</div>
                          <div className="text-xl font-bold text-white mt-1">
                            {selectedAudit.aiAnalysisData.score_breakdown.schema}/100
                          </div>
                          <span className="text-[10px] text-slate-500">Weight: 15%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Critical & Important Issues */}
                {((selectedAudit.aiAnalysisData?.critical_issues && selectedAudit.aiAnalysisData.critical_issues.length > 0) ||
                  (selectedAudit.aiAnalysisData?.important_issues && selectedAudit.aiAnalysisData.important_issues.length > 0)) && (
                  <Card className="bg-slate-900 border-slate-800 text-slate-100">
                    <CardHeader>
                      <CardTitle className="text-base text-rose-400 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" /> Critical &amp; Important SEO Issues
                      </CardTitle>
                      <CardDescription className="text-slate-400 text-xs">
                        High-priority technical impediments requiring immediate remediation
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Critical Issues */}
                      {selectedAudit.aiAnalysisData?.critical_issues?.map((iss, idx) => (
                        <div key={`crit-${idx}`} className="p-3.5 rounded-lg bg-rose-950/20 border border-rose-900/50 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-rose-300 text-sm">{iss.title}</span>
                            <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]">
                              {iss.severity || "CRITICAL"}
                            </Badge>
                          </div>
                          {iss.description && <p className="text-xs text-slate-300">{iss.description}</p>}
                          {iss.evidence && (
                            <p className="text-[11px] font-mono text-slate-400 bg-slate-950/70 p-2 rounded">
                              Evidence: {iss.evidence}
                            </p>
                          )}
                          {iss.recommendation && (
                            <div className="text-xs text-emerald-300 flex items-start gap-1 pt-0.5">
                              <span className="font-semibold">Fix:</span> {iss.recommendation}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Important Issues */}
                      {selectedAudit.aiAnalysisData?.important_issues?.map((iss, idx) => (
                        <div key={`imp-${idx}`} className="p-3.5 rounded-lg bg-amber-950/20 border border-amber-900/50 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-amber-300 text-sm">{iss.title}</span>
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
                              {iss.severity || "HIGH"}
                            </Badge>
                          </div>
                          {iss.description && <p className="text-xs text-slate-300">{iss.description}</p>}
                          {iss.evidence && (
                            <p className="text-[11px] font-mono text-slate-400 bg-slate-950/70 p-2 rounded">
                              Evidence: {iss.evidence}
                            </p>
                          )}
                          {iss.recommendation && (
                            <div className="text-xs text-emerald-300 flex items-start gap-1 pt-0.5">
                              <span className="font-semibold">Fix:</span> {iss.recommendation}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Quick Wins */}
                {selectedAudit.aiAnalysisData?.quick_wins && selectedAudit.aiAnalysisData.quick_wins.length > 0 && (
                  <Card className="bg-slate-900 border-slate-800 text-slate-100">
                    <CardHeader>
                      <CardTitle className="text-base text-emerald-400 flex items-center gap-2">
                        <Zap className="h-5 w-5" /> Actionable Quick Wins
                      </CardTitle>
                      <CardDescription className="text-slate-400 text-xs">
                        Lower-effort optimizations offering high immediate search visibility impact
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {selectedAudit.aiAnalysisData.quick_wins.map((qw, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/50 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-emerald-200 text-sm">{qw.finding}</span>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
                                Impact: {qw.estimated_impact}
                              </Badge>
                              <Badge variant="outline" className="text-slate-400 border-slate-700">
                                Effort: {qw.effort}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-xs text-slate-300">{qw.fix}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Prioritized Recommendations */}
                {selectedAudit.aiAnalysisData?.recommendations && selectedAudit.aiAnalysisData.recommendations.length > 0 && (
                  <Card className="bg-slate-900 border-slate-800 text-slate-100">
                    <CardHeader>
                      <CardTitle className="text-base text-cyan-400 flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5" /> Comprehensive Recommendations
                      </CardTitle>
                      <CardDescription className="text-slate-400 text-xs">
                        Ranked strategic roadmap for long-term organic authority and search rankings
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {selectedAudit.aiAnalysisData.recommendations.map((rec, idx) => (
                        <div key={idx} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-[10px]">
                                {rec.category}
                              </Badge>
                              <span className="font-semibold text-white text-xs sm:text-sm">{rec.finding}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="text-slate-400">Impact: <strong className="text-emerald-400">{rec.estimated_impact}</strong></span>
                              <span className="text-slate-400">· Effort: <strong className="text-amber-400">{rec.effort}</strong></span>
                            </div>
                          </div>
                          <div className="text-xs text-slate-300 pl-1">
                            <strong className="text-slate-400">Recommended Action:</strong> {rec.fix}
                          </div>
                          {rec.falsifiability_check && (
                            <div className="text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800/80">
                              <span className="text-cyan-400 font-semibold">Verification Check:</span> {rec.falsifiability_check}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: SCHEDULED AUDITS */}
        {/* ========================================================================= */}
        {activeTab === "schedules" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-400" /> Recurring SEO Audit Automation
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure automatic weekly or monthly SEO audits. Audits run via background cron with email and WhatsApp delivery.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setIsCreatingSchedule(!isCreatingSchedule)}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs"
              >
                <PlusCircle className="w-4 h-4 mr-1.5" /> {isCreatingSchedule ? "Close Form" : "New Recurring Schedule"}
              </Button>
            </div>

            {schedulesError && (
              <div className="rounded-xl border border-rose-500/50 bg-rose-950/30 p-4 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{schedulesError}</span>
              </div>
            )}

            {/* Schedule Creation Card */}
            {isCreatingSchedule && (
              <Card className="border-slate-800 bg-slate-900/60 shadow-lg">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-white">Create Recurring Schedule</CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    Schedule automated crawler and Claude AI analysis for your website.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateSchedule} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">Target Website URL *</label>
                        <Input
                          type="url"
                          required
                          value={scheduleUrl}
                          onChange={(e) => setScheduleUrl(e.target.value)}
                          placeholder="https://example.com"
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">Audit Frequency *</label>
                        <select
                          value={scheduleFreq}
                          onChange={(e) => setScheduleFreq(e.target.value as "WEEKLY" | "MONTHLY")}
                          className="w-full h-9 rounded-md bg-slate-950 border border-slate-800 px-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="WEEKLY">Weekly (Runs every 7 days)</option>
                          <option value="MONTHLY">Monthly (Runs every 30 days)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">Business Type (Optional)</label>
                        <Input
                          type="text"
                          value={scheduleBusinessType}
                          onChange={(e) => setScheduleBusinessType(e.target.value)}
                          placeholder="e.g. Dental Clinic"
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">City (Optional)</label>
                        <Input
                          type="text"
                          value={scheduleCity}
                          onChange={(e) => setScheduleCity(e.target.value)}
                          placeholder="e.g. Miami"
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300">State / Region (Optional)</label>
                        <Input
                          type="text"
                          value={scheduleState}
                          onChange={(e) => setScheduleState(e.target.value)}
                          placeholder="e.g. FL"
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsCreatingSchedule(false)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={isCreatingSchedule}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs"
                      >
                        {isCreatingSchedule ? "Scheduling..." : "Schedule Recurring Audit"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Schedules List */}
            {schedulesLoading ? (
              <div className="rounded-xl border border-slate-800 p-12 text-center text-slate-500">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-400" />
                <div className="text-sm">Loading recurring schedules...</div>
              </div>
            ) : schedules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-slate-500 space-y-3">
                <Clock className="h-8 w-8 mx-auto text-slate-600" />
                <div className="text-sm">No recurring audit schedules configured yet.</div>
                <Button
                  size="sm"
                  onClick={() => setIsCreatingSchedule(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs"
                >
                  Create Your First Schedule
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {schedules.map((schedule) => (
                  <Card key={schedule.id} className="border-slate-800 bg-slate-900/50 hover:border-slate-700 transition">
                    <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white text-sm truncate">{schedule.targetUrl}</span>
                          <Badge className={schedule.frequency === "WEEKLY" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[10px]" : "bg-purple-500/20 text-purple-300 border-purple-500/30 text-[10px]"}>
                            {schedule.frequency}
                          </Badge>
                          <Badge className={schedule.isActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]" : "bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]"}>
                            {schedule.isActive ? "Active" : "Paused"}
                          </Badge>
                          {schedule.lastAudit?.score !== undefined && schedule.lastAudit?.score !== null && (
                            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-[10px]">
                              Latest Score: {schedule.lastAudit.score}/100
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-3 flex-wrap">
                          <span>Next run: <strong className="text-slate-300">{new Date(schedule.nextRunAt).toLocaleString()}</strong></span>
                          <span>·</span>
                          <span>Last run: <strong className="text-slate-300">{schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : "Never"}</strong></span>
                          {schedule.businessType && <span>· Business: <strong className="text-slate-300">{schedule.businessType}</strong></span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={triggeringScheduleId === schedule.id}
                          onClick={() => handleRunScheduleNow(schedule.id)}
                          className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs h-8"
                        >
                          {triggeringScheduleId === schedule.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1 text-blue-400" />
                          ) : (
                            <Zap className="w-3.5 h-3.5 mr-1 text-amber-400" />
                          )}
                          Run Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTogglePauseSchedule(schedule.id, schedule.isActive)}
                          className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs h-8"
                        >
                          {schedule.isActive ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs h-8"
                        >
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty Results Fallback */}
        {activeTab === "results" && !selectedAudit && (
          <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-slate-500 space-y-3">
            <FileText className="h-8 w-8 mx-auto text-slate-600" />
            <div className="text-sm">No audit record selected. Select an audit from <strong>Audit History</strong> or run a new one.</div>
            <Button size="sm" onClick={() => setActiveTab("submit")} className="bg-blue-600 hover:bg-blue-500 text-white text-xs">
              Run Audit Now
            </Button>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* VERIFIED AUTHENTICATION & ACCOUNT MODAL */}
      {/* ========================================================================= */}
      {showIdentityModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <User className="w-4 h-4 text-blue-400" /> {currentUser ? "Account Profile" : "Client Authentication"}
              </h3>
              <button onClick={() => setShowIdentityModal(false)} className="text-slate-400 hover:text-white text-sm">
                ✕
              </button>
            </div>

            {currentUser ? (
              // Logged In Account State
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-2">
                  <div className="text-xs text-slate-400">Signed in as:</div>
                  <div className="text-sm font-bold text-white">{currentUser.email}</div>
                  {currentUser.name && <div className="text-xs text-slate-300">{currentUser.name}</div>}
                  <div className="flex items-center gap-2 pt-1">
                    <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-[10px]">
                      Role: {currentUser.role}
                    </Badge>
                    <span className="text-[10px] text-slate-500 font-mono">ID: {currentUser.id}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowIdentityModal(false)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Close
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleLogout}
                    className="text-xs"
                  >
                    Sign Out
                  </Button>
                </div>
              </div>
            ) : (
              // Login / Register Form Tabs
              <div className="space-y-4">
                <div className="flex border-b border-slate-800">
                  <button
                    type="button"
                    onClick={() => { setAuthMode("login"); setAuthError(null); }}
                    className={`flex-1 py-2 text-xs font-semibold border-b-2 transition ${authMode === "login" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-white"}`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthMode("register"); setAuthError(null); }}
                    className={`flex-1 py-2 text-xs font-semibold border-b-2 transition ${authMode === "register" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-white"}`}
                  >
                    Register New Account
                  </button>
                </div>

                {authError && (
                  <div className="rounded-lg bg-rose-950/40 border border-rose-500/40 p-2.5 text-xs text-rose-300">
                    {authError}
                  </div>
                )}

                {authMode === "login" ? (
                  <form onSubmit={handleLogin} className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Email Address</label>
                      <Input
                        type="email"
                        required
                        placeholder="you@company.com"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        className="bg-slate-950 border-slate-800 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Password</label>
                      <Input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="bg-slate-950 border-slate-800 text-xs"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        type="submit"
                        disabled={authSubmitting}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs w-full"
                      >
                        {authSubmitting ? "Signing in..." : "Sign In with Verified Session"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleRegister} className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Full Name</label>
                      <Input
                        type="text"
                        placeholder="e.g. Sahil Bansode"
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        className="bg-slate-950 border-slate-800 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Email Address</label>
                      <Input
                        type="email"
                        required
                        placeholder="you@company.com"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        className="bg-slate-950 border-slate-800 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Password (min 8 chars)</label>
                      <Input
                        type="password"
                        required
                        minLength={8}
                        placeholder="••••••••"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="bg-slate-950 border-slate-800 text-xs"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        type="submit"
                        disabled={authSubmitting}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs w-full"
                      >
                        {authSubmitting ? "Creating Account..." : "Create Account & Sign In"}
                      </Button>
                    </div>
                  </form>
                )}

                {/* Legacy Test Harness Bypass (Development Only) */}
                {process.env.NODE_ENV !== "production" && (
                  <div className="pt-3 border-t border-slate-800/80">
                    <details className="text-[11px] text-slate-500">
                      <summary className="cursor-pointer hover:text-slate-400">Non-Production Test ID Mode</summary>
                      <form onSubmit={handleSaveIdentity} className="mt-2 space-y-2">
                        <Input
                          type="text"
                          placeholder="Test User ID (e.g. cmv...)"
                          value={clientIdInput}
                          onChange={(e) => setClientIdInput(e.target.value)}
                          className="bg-slate-950 border-slate-800 text-xs h-7"
                        />
                        <Button type="submit" size="sm" variant="outline" className="text-[10px] h-6 w-full border-slate-800 text-slate-400">
                          Set Test ID
                        </Button>
                      </form>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
